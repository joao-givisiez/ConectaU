import express from "express";

const app = express();
const PORT = Number(process.env.PORT ?? 3101);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    servico: "identidade",
    status: "operacional"
  });
});

app.listen(PORT, () => {
  console.log(`Microsserviço Identidade executando na porta ${PORT}`);
});
