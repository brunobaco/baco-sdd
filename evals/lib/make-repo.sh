#!/usr/bin/env bash
# Monta um repositório git de teste no diretório atual a partir de evals/fixtures/<fixture>.
# Uso: make-repo.sh <fixture> [branch]
#
# Chamado pelo scaffold de cada caso (o scaffold roda com o diretório atual = área de trabalho do agente,
# e $0 do scaffold é o caminho absoluto dele), então o caso tem um scaffold.sh com:
#   bash "$(dirname "$0")/../lib/make-repo.sh" <fixture> <branch>
# Os fixtures são achados pelo caminho deste arquivo, nunca pelo diretório atual.
#
# Convenções dentro de um fixture:
#   .extends   arquivo com o nome de outro fixture; o pai é copiado primeiro e o filho sobrescreve.
#   __BASE_SHA__  texto substituído pelo sha do primeiro commit (usado em "Base:" de plano.md).
#              Isso vira um commit extra "eval: resolve base sha"; o sha gravado é o do primeiro commit.
#   .commit2/  sobreposição aplicada como segundo commit (histórico de dois commits, ex.: spec muda de versão).
set -euo pipefail

fixture="${1:?uso: make-repo.sh <fixture> [branch]}"
branch="${2:-}"
fixtures="$(cd "$(dirname "$0")/../fixtures" && pwd)"

# Identidade e config git isoladas do usuário.
export GIT_AUTHOR_NAME="Baco Eval" GIT_AUTHOR_EMAIL="eval@example.com"
export GIT_COMMITTER_NAME="Baco Eval" GIT_COMMITTER_EMAIL="eval@example.com"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

copy_fixture() { # copia o pai (se houver) e depois o próprio fixture, sem arquivos de controle
  local dir="$fixtures/$1"
  [ -d "$dir" ] || { echo "fixture inexistente: $1" >&2; exit 1; }
  if [ -f "$dir/.extends" ]; then copy_fixture "$(tr -d '[:space:]' < "$dir/.extends")"; fi
  tar -C "$dir" --exclude=./.extends --exclude=./.commit2 -cf - . | tar -C "$PWD" -xf -
}

copy_fixture "$fixture"

git init -q -b main
git add -A
git commit -q -m "eval: fixture $fixture"
first="$(git rev-parse --short HEAD)"

placeholders="$(grep -rl --exclude-dir=.git '__BASE_SHA__' . || true)"
if [ -n "$placeholders" ]; then
  printf '%s\n' "$placeholders" | while IFS= read -r f; do
    sed "s/__BASE_SHA__/$first/g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  git add -A
  git commit -q -m "eval: resolve base sha"
fi

if [ -d "$fixtures/$fixture/.commit2" ]; then
  tar -C "$fixtures/$fixture/.commit2" -cf - . | tar -C "$PWD" -xf -
  git add -A
  git commit -q -m "eval: second commit for $fixture"
fi

if [ -n "$branch" ] && [ "$branch" != main ]; then
  git checkout -q -B "$branch"
fi
