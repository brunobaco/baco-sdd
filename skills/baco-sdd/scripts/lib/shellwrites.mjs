// Files a shell command line writes by redirection (`>`, `>>`, `>|`, `&>`, `&>>`, `<>`, `N>`,
// `>& file`) or through `tee`, read without running it. Used by the plugin hook
// `hooks/write-guard.mjs`, a guard against an agent's accidental writes outside the project, not a
// security boundary. Not a full shell parser: it reads quotes, escapes, comments, heredocs, `$( )`
// and backticks (also inside double quotes, read as commands of their own), process substitution,
// `$(( ))`, `(( ))` and `[[ ]]`, and the options of common wrappers (sudo, env, timeout, nice, nohup,
// stdbuf, command, exec, xargs, time) before `tee`. Known gaps, by design: `sh -c '...'` and `eval`
// strings, aliases and functions, expansions inside heredoc bodies, and files a program writes by
// itself (`cp`, `dd of=`, `node -e`). Each target keeps how it was written, for the caller to judge:
// `glob` (an unquoted `*`, `?` or `[`), `expands` (a `$` or backtick outside single quotes), `tilde`
// (an unquoted leading `~`) and `afterCd` (a `cd`, `pushd` or `popd` of the same shell came before
// it in the command, not one inside a substitution or a closed `( )` subshell; or, for a file given
// to tee, the `env -C` or `sudo -D` that wraps that tee).

const SEPARATORS = new Set(['|', '||', '&', '&&', ';', ';;', '\n', '(', ')']);
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>']);
const DIR_CHANGERS = new Set(['cd', 'pushd', 'popd']);
// Wrappers that run another command: options that take the next word as value, options that change
// the folder, and positional operands before the command.
const WRAPPERS = {
  sudo: { args: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T', '-R', '--user', '--group', '--chdir'], dir: ['-D', '--chdir'], operands: 0 },
  env: { args: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'], dir: ['-C', '--chdir'], operands: 0, assignments: true },
  timeout: { args: ['-s', '-k', '--signal', '--kill-after'], dir: [], operands: 1 },
  nice: { args: ['-n', '--adjustment'], dir: [], operands: 0 },
  nohup: { args: [], dir: [], operands: 0 },
  stdbuf: { args: ['-i', '-o', '-e', '--input', '--output', '--error'], dir: [], operands: 0 },
  command: { args: [], dir: [], operands: 0 },
  builtin: { args: [], dir: [], operands: 0 },
  exec: { args: ['-a'], dir: [], operands: 0 },
  time: { args: [], dir: [], operands: 0 },
  xargs: { args: ['-I', '-n', '-P', '-d', '-E', '-L', '-s', '-a', '--arg-file', '--delimiter', '--max-args', '--max-procs', '--replace', '--eof', '--max-lines', '--max-chars'], dir: [], operands: 0 },
};

// Index of the `)` that closes the `(` at `i`, skipping quoted text; s.length when none.
function closeParen(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === "'") { const e = s.indexOf("'", j + 1); j = e < 0 ? s.length : e; continue; }
    if (c === '"') { let e = j + 1; while (e < s.length && s[e] !== '"') e += s[e] === '\\' ? 2 : 1; j = e; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return s.length;
}
// Index of the backtick that closes the one at `i`; s.length when none.
function closeTick(s, i) {
  for (let j = i + 1; j < s.length; j++) { if (s[j] === '\\') j++; else if (s[j] === '`') return j; }
  return s.length;
}

function tokenize(s) {
  const tokens = [];
  const heredocs = [];
  let word = null;
  const ensure = () => { if (word === null) word = { type: 'word', value: '', quoted: false, glob: false, expands: false, tilde: false, subs: [] }; return word; };
  const flush = () => { if (word !== null) { tokens.push(word); word = null; } };
  const op = (v) => { flush(); tokens.push({ type: 'op', value: v }); };
  const plain = (c) => {
    const w = ensure();
    if (w.value === '' && !w.quoted && c === '~') w.tilde = true;
    if (c === '*' || c === '?' || c === '[') w.glob = true;
    w.value += c;
  };
  // `$(...)` or a backtick block starting at `i`: its text becomes a command of its own.
  const substitution = (i) => {
    const w = ensure();
    w.expands = true;
    const tick = s[i] === '`';
    const end = tick ? closeTick(s, i) : closeParen(s, i + 1);
    w.subs.push(s.slice(i + (tick ? 1 : 2), end));
    w.value += s.slice(i, end + 1);
    return end + 1;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { if (i + 1 < s.length && s[i + 1] !== '\n') { ensure().quoted = true; word.value += s[i + 1]; } i += 2; continue; }
    if (c === "'") { const end = s.indexOf("'", i + 1); const stop = end < 0 ? s.length : end; const w = ensure(); w.quoted = true; w.value += s.slice(i + 1, stop); i = stop + 1; continue; }
    if (c === '"') {
      const w = ensure();
      w.quoted = true;
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length) { w.value += s[j + 1]; j += 2; continue; }
        if (s.startsWith('$((', j)) { w.expands = true; const e = closeParen(s, j + 1); w.value += s.slice(j, e + 1); j = e + 1; continue; }
        if (s.startsWith('$(', j) || s[j] === '`') { j = substitution(j); continue; }
        if (s[j] === '$') w.expands = true;
        w.value += s[j];
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === '`' || (c === '$' && s[i + 1] === '(' && s[i + 2] !== '(')) { i = substitution(i); continue; }
    if (c === '$' && s.startsWith('$((', i)) { const w = ensure(); w.expands = true; const e = closeParen(s, i + 1); w.value += s.slice(i, e + 1); i = e + 1; continue; }
    if (c === '$') { ensure().expands = true; plain(c); i++; continue; }
    if (c === '(' && s[i + 1] === '(' && word === null) { i = closeParen(s, i) + 1; continue; }
    if ((c === '<' || c === '>') && s[i + 1] === '(') {
      // Process substitution: not a file, but its command may write.
      flush();
      const end = closeParen(s, i + 1);
      tokens.push({ type: 'word', value: '', procsub: true, subs: [s.slice(i + 2, end)] });
      i = end + 1;
      continue;
    }
    if (c === '\n') {
      op('\n');
      i++;
      // Heredoc bodies start on the next line: skip each up to its delimiter line.
      while (heredocs.length) {
        const { delim, strip } = heredocs.shift();
        while (i < s.length) {
          const nl = s.indexOf('\n', i);
          const line = s.slice(i, nl < 0 ? s.length : nl);
          i = nl < 0 ? s.length : nl + 1;
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
        }
      }
      continue;
    }
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    if (c === '#' && word === null) { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; continue; } // a comment
    if (c === '|' || c === ';' || c === '(' || c === ')') {
      const two = s.slice(i, i + 2);
      if (two === '||' || two === ';;') { op(two); i += 2; } else if (two === '|&') { op('|'); i += 2; } else { op(c); i++; }
      continue;
    }
    if (c === '&') {
      if (s.startsWith('&>>', i)) { op('&>>'); i += 3; } else if (s.startsWith('&>', i)) { op('&>'); i += 2; } else if (s.startsWith('&&', i)) { op('&&'); i += 2; } else { op('&'); i++; }
      continue;
    }
    if (c === '>' || c === '<') {
      // A word made only of digits right before the operator is a file descriptor, not a word.
      if (word !== null && !word.quoted && /^\d+$/.test(word.value)) word = null;
      flush();
      const three = s.slice(i, i + 3);
      const two = s.slice(i, i + 2);
      if (three === '<<<') { op('<<<'); i += 3; continue; }
      if (three === '<<-' || two === '<<') {
        const strip = three === '<<-';
        op('<<');
        i += strip ? 3 : 2;
        while (s[i] === ' ' || s[i] === '\t') i++;
        let delim = '';
        while (i < s.length && !/[\s;&|<>()]/.test(s[i])) { if (s[i] !== "'" && s[i] !== '"' && s[i] !== '\\') delim += s[i]; i++; }
        if (delim) heredocs.push({ delim, strip });
        continue;
      }
      if (['>>', '>|', '>&', '<>', '<&'].includes(two)) { op(two); i += 2; continue; }
      op(c); i++;
      continue;
    }
    plain(c);
    i++;
  }
  flush();
  return tokens;
}

const target = (w, afterCd) => ({ value: w.value, glob: w.glob, expands: w.expands, tilde: w.tilde, afterCd });
const isAssignment = (w) => !w.quoted && /^[A-Za-z_]\w*=/.test(w.value);

function scan(command, cdBefore, depth) {
  const tokens = tokenize(command);
  const targets = [];
  let cd = cdBefore;
  let inTest = false; // inside [[ ]]
  let state = { kind: 'start' }; // start | wrapper | args
  let inTee = false;
  // `env -C` or `sudo -D` move only the wrapped program (its own operands, such as tee's files), not
  // the shell: redirections and the next commands keep the shell's folder.
  let wrapDir = false;
  const saved = []; // the shell's folder state at each `(`: a cd inside a subshell stays there
  // A substitution runs in a subshell: its cd counts for its own targets, never for the caller.
  const sub = (w) => {
    if (depth > 8) return;
    for (const text of w.subs ?? []) targets.push(...scan(text, cd, depth + 1).targets);
  };
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.type === 'op') {
      if (tk.value === '(') saved.push(cd);
      else if (tk.value === ')' && saved.length) cd = saved.pop();
      if (SEPARATORS.has(tk.value)) { state = { kind: 'start' }; inTee = false; wrapDir = false; continue; }
      const next = tokens[k + 1];
      if (inTest || next?.type !== 'word' || next.procsub) continue;
      sub(next);
      if (WRITE_OPS.has(tk.value)) targets.push(target(next, cd));
      else if (tk.value === '>&' && !/^(\d+-?|-)$/.test(next.value)) targets.push(target(next, cd));
      k++; // the word after `<`, `<&`, `<<<` is read, not written
      continue;
    }
    sub(tk);
    if (tk.procsub) continue;
    const w = tk.value;
    if (!tk.quoted && w === '[[') { inTest = true; continue; }
    if (!tk.quoted && w === ']]') { inTest = false; continue; }
    if (state.kind === 'wrapper') {
      const spec = state.spec;
      if (state.pending) { state.pending = false; continue; }
      if (!state.ended && w === '--') { state.ended = true; continue; }
      if (!state.ended && w.startsWith('-') && w.length > 1) {
        if (spec.args.includes(w)) state.pending = true;
        if (spec.dir.some((o) => w === o || w.startsWith(`${o}=`) || (o.length === 2 && w.startsWith(o) && w.length > 2))) wrapDir = true;
        continue;
      }
      if (spec.assignments && isAssignment(tk)) continue;
      if (state.operands > 0) { state.operands--; continue; }
      state = { kind: 'start' }; // this word is the wrapped command
    }
    if (state.kind === 'start') {
      if (isAssignment(tk)) continue; // VAR=value before the command
      const name = w.split('/').pop();
      if (Object.hasOwn(WRAPPERS, name)) {
        state = { kind: 'wrapper', spec: WRAPPERS[name], operands: WRAPPERS[name].operands, ended: false, pending: false };
        continue;
      }
      state = { kind: 'args' };
      if (DIR_CHANGERS.has(name)) cd = true;
      inTee = name === 'tee';
      continue;
    }
    if (inTee && !w.startsWith('-')) targets.push(target(tk, cd || wrapDir));
  }
  return { targets };
}

// { targets: [{ value, glob, expands, tilde, afterCd }] } in command order.
export function shellWrites(command) {
  return { targets: scan(String(command ?? ''), false, 0).targets };
}
