# Senpai — instrucoes para agentes

- Leia `docs/DEVIN-CLI.md` antes de alterar a integracao com agentes de LLM.
- O backend de producao e exclusivamente `devin`; nao introduza dependencia obrigatoria de `codex` ou `claude`.
- Execute comandos a partir da raiz do repositorio, exceto os comandos Go/Wails, que rodam em `app/`.
- Depois de alterar `workflows/`, rode `mhl lint workflows` e `mhl test workflows`.
- Depois de alterar `app/`, rode `go test ./...` e `go vet ./...` em `app/`.
- Depois de alterar `app/frontend/`, rode `npm run build` em `app/frontend/`.
- Nao leia nem grave dados de outro work-item. Todo acesso em `projects/` deve ficar restrito ao `project_id` recebido.
- Nao grave segredos no repositorio, em prompts ou em argumentos de linha de comando.
