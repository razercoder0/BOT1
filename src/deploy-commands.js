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
    .setName("retirarpontos")
    .setDescription("Desfaz o resultado mais recente entre dois clans")
    .addStringOption((option) =>
      option
        .setName("vencedora")
        .setDescription("Tag do clan que venceu a partida")
        .setRequired(true)
        .setMaxLength(8)
    )
    .addStringOption((option) =>
      option
        .setName("perdedora")
        .setDescription("Tag do clan que perdeu a partida")
        .setRequired(true)
        .setMaxLength(8)
    )
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("resetarpontos")
    .setDescription("Zera o ranking e o historico de partidas")
    .setDefaultMemberPermissions(null)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cxc")
    .setDescription("Confrontos oficiais entre clans")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("painel")
        .setDescription("Publica ou atualiza a Central Ranked")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("desafiar")
        .setDescription("Desafia outro clan para um confronto")
        .addStringOption((option) =>
          option
            .setName("clan")
            .setDescription("Tag do clan adversario")
            .setRequired(true)
            .setMaxLength(8)
        )
        .addStringOption((option) =>
          option
            .setName("modo")
            .setDescription("Modo do confronto")
            .setRequired(true)
            .addChoices(
              { name: "Gapple", value: "gapple" },
              { name: "NoDebuff", value: "nodebuff" }
            )
        )
        .addIntegerOption((option) =>
          option
            .setName("jogadores")
            .setDescription("Quantidade de jogadores por clan")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption((option) =>
          option
            .setName("melhor_de")
            .setDescription("Quantidade maxima de partidas")
            .setRequired(true)
            .addChoices(
              { name: "MD1", value: 1 },
              { name: "MD3", value: 3 },
              { name: "MD5", value: 5 }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("consultar")
        .setDescription("Mostra o confronto ativo do seu clan")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancelar")
        .setDescription("Cancela um desafio que ainda nao foi aceito")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("prova")
        .setDescription("Envia a print do resultado selecionado")
        .addAttachmentOption((option) =>
          option
            .setName("imagem")
            .setDescription("Print da tela mostrando a vitoria")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("historico")
        .setDescription("Mostra os confrontos recentes de um clan")
        .addStringOption((option) =>
          option
            .setName("clan")
            .setDescription("Tag do clan; deixe vazio para usar o seu")
            .setRequired(false)
            .setMaxLength(8)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("encerrar")
        .setDescription("Staff encerra o confronto deste canal")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("resolver")
        .setDescription("Staff resolve uma contestacao")
        .addStringOption((option) =>
          option
            .setName("vencedora")
            .setDescription("Tag do clan vencedor")
            .setRequired(true)
            .setMaxLength(8)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("anular")
        .setDescription("Staff anula um CXC confirmado")
        .addStringOption((option) =>
          option
            .setName("id")
            .setDescription("ID exibido no painel ou no historico")
            .setRequired(true)
            .setMaxLength(20)
        )
    )
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
  console.log("Comandos de clans, CXC e ranking registrados com sucesso.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { commands };
