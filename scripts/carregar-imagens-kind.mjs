// Carrega as imagens do ConectaU (construídas com `docker compose build`) no nó do cluster
// Kubernetes do Docker Desktop no modo kind, que não enxerga as imagens locais do Docker.
//
//   node scripts/carregar-imagens-kind.mjs [nome-do-no]
//
// O nome padrão do nó é desktop-control-plane (veja com `kubectl get nodes`).
// No modo kubeadm do Docker Desktop este passo não é necessário.
import { execSync } from "node:child_process";

const no = process.argv[2] ?? "desktop-control-plane";
const imagens = execSync('docker image ls --format "{{.Repository}}:{{.Tag}}"', { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((imagem) => imagem.startsWith("conectau/") && imagem.endsWith(":1.0.0") && !imagem.startsWith("conectau/gateway"));

if (imagens.length === 0) {
  console.error("Nenhuma imagem conectau/*:1.0.0 encontrada. Rode antes: docker compose build");
  process.exit(1);
}

for (const imagem of imagens) {
  process.stdout.write(`Carregando ${imagem} no nó ${no}... `);
  execSync(`docker save ${imagem} | docker exec -i ${no} ctr -n k8s.io images import -`, { stdio: "ignore" });
  console.log("ok");
}
console.log(`\n${imagens.length} imagem(ns) carregada(s). Agora: kubectl apply -k infrastructure/kubernetes`);
