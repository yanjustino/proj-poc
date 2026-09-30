# Validação local do `radahn.yaml` (ping/pong)

Antes de subir a aplicação para a esteira, o engenheiro pode validar o `radahn.yaml` **localmente**
usando docker ou podman. O agente (modo `spec`) deve **perguntar** se o engenheiro deseja fazer
essa validação local e, em caso afirmativo, guiá-lo pelos passos abaixo.

> **Pré-requisito:** docker **ou** podman instalado e funcionando corretamente.

## Estratégia

1. Garantir que o `radahn.yaml` gerado é sintaticamente válido (YAML com espaços, `kind:
   ApplicationWorkflow`, `routes`/`behaviors` casando).
2. Subir um **behavior mínimo do tipo ping/pong** localmente (uma rota `GET /ping` que responde
   `pong` via `HttpStatusCodeResult`), confirmando que o motor carrega a spec e serve a rota.
3. Depois de validar o ping/pong, substituir pela spec real e repetir o `build`/`run` para
   confirmar que o motor **carrega sem erros de boot** (a validação estrutural roda no start).

O exemplo pronto está em `examples/ping-pong/` (`radahn.yaml` + `Dockerfile`).

## Passos com docker

```bash
# a partir do diretório examples/ping-pong (ou do PATH_APPLICATION com a spec real)
docker build -t radahn-local:validacao .
docker run --rm -p 8080:8080 --name radahn-local radahn-local:validacao
```

Em outro terminal:

```bash
curl -i http://localhost:8080/ping
# Esperado: HTTP/1.1 200 OK  +  {"message":"pong"}
```

Para encerrar: `Ctrl+C` no terminal do container (ou `docker stop radahn-local`).

## Passos com podman

```bash
podman build -t radahn-local:validacao .
podman run --rm -p 8080:8080 --name radahn-local radahn-local:validacao
```

O `curl` de verificação é idêntico ao do docker.

## Interpretação do resultado

- **Sobe e responde `pong` (HTTP 200):** o motor está funcional e a spec mínima é válida. Prossiga
  trocando pela spec real.
- **Falha no boot** (`failed to load workflow: parsing workflow YAML`, `unexpected kind`,
  `workflow has no routes`, ...): a spec tem erro estrutural. Use o playbook de diagnóstico
  (`05-diagnostico.md`) para corrigir e rode novamente.
- **`bind: address already in use`:** a porta 8080 está ocupada; use `-p 8081:8080` e ajuste o
  `curl`, ou libere a porta.

## Validando a spec real (sem ping/pong)

Copie o `radahn.yaml` real e o `Dockerfile` para o mesmo diretório e repita `build`/`run`.
Como a validação estrutural roda no **start**, um boot bem-sucedido já confirma que a spec é
estruturalmente válida. Para exercitar as rotas com dependências (banco, subsistemas), forneça as
variáveis de ambiente com `--env-file .env` (nunca faça commit desse `.env`):

```bash
docker run --rm -p 8080:8080 --env-file .env radahn-local:validacao
```
