const tarefas = [];

export function cadastrar(titulo) {
  if (typeof titulo !== 'string' || titulo.trim() === '') {
    throw new Error('A tarefa precisa de um título.');
  }
  const tarefa = { id: tarefas.length + 1, titulo: titulo.trim() };
  tarefas.push(tarefa);
  return tarefa;
}
