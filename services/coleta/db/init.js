// Inicialização do banco do serviço Coleta (instância coleta-db, MongoDB).
// Executado uma única vez, na criação do volume, pelo entrypoint oficial do MongoDB.
// Cria um usuário só com permissão no banco "coleta" (menor privilégio) e os índices.

const nomeBanco = process.env.MONGO_INITDB_DATABASE || "coleta";
const usuario = process.env.COLETA_DB_USUARIO;
const senha = process.env.COLETA_DB_SENHA;

const banco = db.getSiblingDB(nomeBanco);

if (usuario && senha) {
  banco.createUser({ user: usuario, pwd: senha, roles: [{ role: "readWrite", db: nomeBanco }] });
}

banco.createCollection("fontes");
banco.createCollection("execucoes");
banco.createCollection("candidatos");

banco.fontes.createIndex({ url: 1 }, { unique: true });
banco.execucoes.createIndex({ fonteId: 1, iniciadaEm: -1 });
banco.candidatos.createIndex({ hash: 1 }, { unique: true });
banco.candidatos.createIndex({ status: 1, coletadoEm: -1 });
