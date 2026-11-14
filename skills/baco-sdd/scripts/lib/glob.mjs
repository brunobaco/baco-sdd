// Path globs: `**` (any number of folders), `*` and `?` (within one folder), `{a,b}` alternation.
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{' && pattern.indexOf('}', i) > i) {
      // `{a,b}` brace alternation (no nesting).
      const end = pattern.indexOf('}', i);
      re += `(?:${pattern.slice(i + 1, end).split(',').map((a) => a.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')).join('|')})`;
      i = end;
    }
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
