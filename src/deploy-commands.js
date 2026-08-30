require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Publica ou atualiza o painel de acesso dos clans")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("resetclans")
    .setDescription("Apaga todos os clans apos uma confirmacao de seguranca")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("ranking")
    .setDescription("Mostra a classificacao atual dos clans")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("clan")
    .setDescription("Sistema de clans")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("resultado")
        .setDescription("Registra o resultado de uma partida entre clans")
        .addStringOption((option) =>
          option
            .setName("vencedora")
            .setDescription("Tag do clan vencedor")
            .setRequired(true)
            .setMaxLength(8)
        )
        .addStringOption((option) =>
          option
            .setName("perdedora")
            .setDescription("Tag do clan perdedor")
            .setRequired(true)
            .setMaxLength(8)
        )
        .addIntegerOption((option) =>
          option
            .setName("pontos")
            .setDescription("Pontos que o vencedor recebera")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("criar")
        .setDescription("Cria um clan novo e vira lider dele")
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Tag curta do clan, exemplo: ABC")
            .setRequired(true)
            .setMaxLength(8)
        )
        .addStringOption((option) =>
          option
            .setName("nome")
            .setDescription("Nome completo do clan")
            .setRequired(true)
            .setMaxLength(40)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("entrar")
        .setDescription("Pede para entrar em um clan existente")
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Tag do clan, exemplo: ABC")
            .setRequired(true)
            .setMaxLength(8)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("painel")
        .setDescription("Mostra o painel do seu clan")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("convidar")
        .setDescription("Convida um membro para o seu clan")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Membro que recebera o convite")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("adicionar")
        .setDescription("Adiciona um membro ao seu clan")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Membro que sera adicionado")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remover")
        .setDescription("Remove um membro do seu clan")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Membro que sera removido")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("desfazer")
        .setDescription("Desfaz um clan com confirmacao")
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Staff informa a tag; o lider pode deixar vazio")
            .setRequired(false)
            .setMaxLength(8)
        )
    )
    .toJSON()
];

async function main() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;

  if (!token || !clientId || !guildId) {
    throw new Error("Preencha DISCORD_TOKEN, CLIENT_ID e GUILD_ID no arquivo .env.");
  }

  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log("Comandos /painel, /ranking, /clan e /resetclans registrados com sucesso.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
