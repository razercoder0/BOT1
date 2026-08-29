# Previa do bot de clans

Mensagem para pedir a opiniao do cliente:

```text
Montei o fluxo do bot assim:

Quando a pessoa entra no servidor, o bot manda uma mensagem perguntando se ela quer criar um clan ou entrar em um clan existente.

Se ela criar um clan, o bot cria automaticamente:
- cargo do clan;
- cargo de lider;
- chat privado;
- call privada.

Quem criou vira lider do clan.

Se outra pessoa quiser entrar nesse clan, ela nao entra automaticamente. O lider recebe um embed com dois botoes:
- Aceitar
- Recusar

Se aceitar, a pessoa ganha o cargo e acesso ao chat/call do clan.
Se recusar, ela recebe aviso no privado.

Tambem vai existir um chat publico geral para todos.

Voce prefere que os pedidos de entrada cheguem no privado do lider ou em um canal tipo #pedidos-de-clan?
E voce quer que cada clan tenha so um lider ou pode ter mais de um administrador?
```

## Como os embeds ficam

### Boas-vindas

**Bem-vindo ao servidor**

Confirme seu clan para liberar seu espaco privado.

Criar clan:
`/clan criar tag:ABC nome:Alpha Brasil`

Entrar em clan:
`/clan entrar tag:ABC`

Chat publico:
`#chat-publico`

### Clan criado

**Clan criado com sucesso**

O clan **ABC - Alpha Brasil** foi criado.

Lider: `@usuario`

Cargo: `Clan ABC`

Chat: `#clan-abc`

Call: `call-abc`

### Pedido para o lider

**Pedido de entrada no clan**

`@usuario` quer entrar no clan **ABC - Alpha Brasil**.

Botoes:

`Aceitar` / `Recusar`
