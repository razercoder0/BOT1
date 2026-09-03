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
- Lideres podem usar o chat e a call, mas nao podem renomear, mudar o assunto, alterar permissoes ou excluir esses canais.
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
- A staff registra partidas com `/clan resultado vencedora:ABC perdedora:XYZ pontos:3`.
- `/ranking` mostra pontos, vitorias, derrotas e partidas de todos os clans.
- O painel fixo do ranking e atualizado automaticamente quando os pontos mudam.
- A Central Ranked fica fixa no canal `ranked`, sem reenviar mensagens a cada reinicio.
- Pelo botao `Criar desafio`, o lider escolhe adversario, Gapple ou NoDebuff, formato de 1v1 ate 20v20 e MD1, MD3 ou MD5.
- Os botoes `Meus confrontos` e `Ranking` mostram as informacoes em uma resposta privada.
- `/retirarpontos` desfaz a partida mais recente informada e `/resetarpontos` zera somente a classificacao.
- O lider desafia outro clan com `/cxc desafiar clan:ABC modo:Gapple jogadores:5 melhor_de:3`.
- O convite CXC aparece no chat privado do clan adversario e somente o lider desafiado pode responder.
- Depois do aceite, o bot cria um canal privado para os dois lideres e para a staff.
- Um lider seleciona o vencedor pelo painel e envia a print com `/cxc prova imagem:arquivo`.
- O outro lider confirma ou contesta. Os pontos so entram no ranking depois da confirmacao.
- Canais cancelados ou concluidos sao excluidos apos 10 segundos; canais antigos finalizados tambem sao limpos no reinicio. Canais contestados permanecem abertos ate a staff resolver.
- `/cxc consultar`, `/cxc cancelar` e `/cxc historico` ajudam os lideres a acompanhar os confrontos.
- A staff pode cancelar qualquer confronto com `/cxc cancelar id:ID`, inclusive antes do aceite.
- A staff usa `/cxc encerrar`, `/cxc resolver vencedora:ABC` e `/cxc anular id:ID`.
- A staff usa `/cxc painel` para publicar ou atualizar manualmente a Central Ranked.
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
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_sua_chave
PUBLIC_CHAT_ID=id_do_chat_publico_existente
PUBLIC_CHAT_NAME=chat-publico
CREATE_PUBLIC_CHAT=false
COMMUNITY_ROLE_ID=id_do_cargo_da_comunidade
ADMIN_ROLE_IDS=id_cargo_adm_1,id_cargo_adm_2,id_cargo_adm_3
ACCESS_CHANNEL_ID=id_do_canal_de_acesso
ACCESS_CHANNEL_NAME=acesso
RANKING_CHANNEL_ID=id_do_canal_do_ranking
RANKED_CHANNEL_ID=id_do_canal_da_central_ranked
RANKED_CHANNEL_NAME=ranked
CLAN_CATEGORY_NAME=CLANS
CXC_CATEGORY_ID=id_da_categoria_dos_confrontos
CXC_CATEGORY_NAME=CONFRONTOS CXC
CXC_WIN_POINTS=3
```

4. No Supabase, abra o **SQL Editor**, cole o conteudo de supabase/schema.sql e clique em **Run**.

5. Registre os comandos:

```bash
npm run deploy
```

6. Ligue o bot:

```bash
npm start
```

O bot cria e mantem o painel de acesso automaticamente. Um administrador tambem pode usar `/painel` para publica-lo manualmente. A Central Ranked e localizada por `RANKED_CHANNEL_ID` ou por um canal chamado `ranked`; o bot nao cria esse canal e `/cxc painel` publica ou atualiza sua mensagem fixa.

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
- Manage Messages
- Attach Files
- Embed Links
- Use Slash Commands

Importante: o cargo do bot precisa ficar acima dos cargos de clan na lista de cargos do Discord.

## Dados

Com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` configurados, o bot carrega e salva no Supabase todos os clans, pontos, confrontos, convites e configuracoes. Cada alteracao tambem gera uma copia local em `data/bot-data.json`.

Na primeira inicializacao, se a tabela estiver vazia, o arquivo local existente e enviado automaticamente ao Supabase. Depois disso, o Supabase passa a ser a fonte principal e os dados sobrevivem a reinicios e deploys no Render.

Use somente a **Secret key** (`sb_secret_...`) no servidor. Nunca envie essa chave em mensagens, imagens ou para o GitHub. Sem as variaveis do Supabase, o bot continua funcionando no modo local, mas o Render pode apagar esse arquivo em novos deploys.
