# CRM do Sérgio

CRM comercial em um único arquivo (`index.html`): clientes com Curva ABC, vendas, registro de visitas técnico-comerciais e agenda semanal.

- **Funciona offline**: tudo é gravado primeiro no aparelho e sincronizado quando houver internet.
- **Login e sincronização** entre notebook e celular via Supabase (projeto `crm-sergio`).
- **Sem build no deploy**: o CSS do Tailwind já está compilado dentro do `index.html`.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | O app pronto. É o único arquivo publicado. |
| `dev/index.src.html` | Fonte editável (Tailwind ainda não compilado). |
| `dev/build.sh` | Gera o `index.html` a partir do fonte. |

## Deploy na Vercel

1. Importe este repositório na Vercel.
2. Framework Preset: **Other**. Deixe Build Command e Output Directory **vazios**.
3. **Não** use a integração Supabase da Vercel: o endereço e a chave pública já estão no `index.html`.

## Configuração no Supabase (obrigatória após o primeiro deploy)

1. **Authentication → URL Configuration**: coloque a URL da Vercel em **Site URL** e em **Redirect URLs**.
   Sem isso, o link de confirmação de e-mail redireciona para `localhost:3000`.
2. Depois que as contas necessárias forem criadas: **Authentication → Sign In / Providers → desative "Allow new users to sign up"**.

## Editar o app

```bash
# edite dev/index.src.html e depois:
cd dev && ./build.sh   # precisa de Node.js e Python 3
```

Edite sempre o `dev/index.src.html`. Alterações feitas direto no `index.html` são sobrescritas no próximo build,
e classes novas do Tailwind só ganham estilo depois do build.

## Como os dados ficam salvos

- **No aparelho**: `localStorage`, separado por usuário. Ao sair da conta, os dados locais são apagados.
- **Na nuvem**: tabela `public.registros`, protegida por RLS (cada usuário só acessa os próprios dados).
- **Conflitos**: se o mesmo registro for editado em dois aparelhos, vence a edição mais recente.
- **Backup**: botão "Backup" no topo exporta tudo em JSON.

## Limitações conhecidas

- Projetos gratuitos do Supabase pausam após 7 dias sem uso. O app continua funcionando no aparelho, mas não sincroniza até o projeto ser reativado no painel.
- O e-mail padrão do Supabase tem limite baixo de envios por hora.
- A resolução de conflitos usa o relógio de cada aparelho.
- A chave em `SUPABASE_KEY` é a chave **pública** (publishable). Nunca coloque a chave `service_role` neste arquivo.
