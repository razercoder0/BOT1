# Discord Clan Bot

Bot para Discord que organiza membros por clan.

## O que ele faz

- Cria um canal `acesso` com um painel moderno em Components V2.
- Usa Components V2 na central do clan, painel, convites, pedidos e confirmacoes.
- O painel tem botoes para criar clan, entrar em clan e editar o proprio painel.
- O botao `Comunidade` libera o cargo geral sem obrigar a pessoa a entrar em um clan.
- Criar e entrar em clan abre um formulario, sem precisar decorar comandos.
- Ao criar um clan ou ter a entrada aprovada, o cargo da comunidade tambem e garantido automaticamente.
- O editor permite mudar titulo, frase, botoes e cor e so funciona para administradores.
- Permite criar clan com `/clan criar tag:ABC nome:Alpha Brasil`.
- Quando o clan e criado, o bot cria:
  - cargo do clan;
  - cargo de lider;
  - chat privado;
  - call privada;
  - chat publico geral, se ainda nao existir.
- Quem cria o clan vira lider.
- Se alguem tentar entrar em um clan existente, o lider recebe um embed com botoes de aceitar ou recusar.
- O lider pode usar:
  - `/clan convidar usuario:@membro`
  - `/clan adicionar usuario:@membro`
  - `/clan remover usuario:@membro`
  - `/clan painel`
  - `/clan desfazer` para o lider excluir o proprio clan com confirmacao
- A staff pode usar `/clan desfazer tag:ABC` para excluir um clan especifico com confirmacao.
- Os clans, membros, configuracao do painel e pedidos pendentes continuam salvos quando o bot reinicia.
- Cada chat de clan recebe uma mensagem de orientacao com os comandos principais.
- A central privada possui um seletor de usuarios para o lider convidar membros sem digitar comandos.
- Administradores podem usar `/resetclans`, com confirmacao, para apagar somente a estrutura dos clans.

## Como ligar

1. Instale as dependencias:

```bash
npm install
```

2. Copie `.env.example` para `.env`.

3. Preencha:

```env
DISCORD_TOKEN=token_do_bot
CLIENT_ID=id_do_aplicativo_do_bot
GUILD_ID=id_do_servidor
PUBLIC_CHAT_ID=id_do_chat_publico_existente
PUBLIC_CHAT_NAME=chat-publico
CREATE_PUBLIC_CHAT=false
COMMUNITY_ROLE_ID=id_do_cargo_da_comunidade
ADMIN_ROLE_IDS=id_cargo_adm_1,id_cargo_adm_2,id_cargo_adm_3
ACCESS_CHANNEL_NAME=acesso
CLAN_CATEGORY_NAME=CLANS
```

4. Registre os comandos:

```bash
npm run deploy
```

5. Ligue o bot:

```bash
npm start
```

O bot cria e mantem o painel automaticamente. Um administrador tambem pode usar `/painel` para publicar ou atualizar a mensagem manualmente.

## Render e health check

O bot abre um servidor HTTP em `0.0.0.0:$PORT`, como exigido pelo Render:

- `/` responde ao keep-alive;
- `/health` informa se o Discord esta conectado;
- no Render, `RENDER_EXTERNAL_URL` e detectada automaticamente e recebe um ping a cada 10 minutos;
- use `KEEP_ALIVE_ENABLED=false` para desativar o ping interno.

No painel do Render, configure o Health Check Path como `/health`. Para maior confiabilidade, configure tambem um monitor externo para acessar a URL publica a cada 10 minutos.

O workflow `.github/workflows/keep-alive.yml` faz esse ping externo pelo GitHub Actions a cada 10 minutos. Ele tambem pode ser executado manualmente pela aba Actions do repositorio.

Se `PUBLIC_CHAT_ID` estiver preenchido, o bot usa esse chat publico e nao cria outro. Para o bot criar o canal definido em `PUBLIC_CHAT_NAME`, use `CREATE_PUBLIC_CHAT=true`. Com `false`, somente o canal `acesso` e criado automaticamente.

Separe os cargos administrativos em `ADMIN_ROLE_IDS` usando virgulas. Quem possuir qualquer um deles pode editar o painel e usar o reset de clans.

## Permissoes que o bot precisa

No convite do bot, marque estas permissoes:

- Manage Roles
- Manage Channels
- Send Messages
- View Channels
- Read Message History
- Use Slash Commands

Importante: o cargo do bot precisa ficar acima dos cargos de clan na lista de cargos do Discord.

## Dados

Os dados ficam salvos automaticamente em `data/bot-data.json`. Guarde esse arquivo ao mover o bot para outro computador.
