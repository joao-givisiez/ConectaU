/**
 * Fonte de exemplo usada na demonstração. Os itens são FICTÍCIOS: imitam o formato de
 * eventos divulgados pela universidade, mas não representam editais nem eventos reais.
 * As datas são relativas ao momento da coleta, para que os prazos estejam sempre abertos.
 */
export interface ItemColetado {
  titulo: string;
  descricao: string;
  data?: string;
  url: string;
}

const DIA = 24 * 3600 * 1000;

function daquiA(dias: number, hora = 14): string {
  const data = new Date(Date.now() + dias * DIA);
  data.setUTCHours(hora + 3, 0, 0, 0);
  return data.toISOString();
}

export function itensDeExemplo(): ItemColetado[] {
  return [
    {
      titulo: "Workshop de Docker e Kubernetes",
      descricao:
        "Workshop prático sobre containers e orquestração para a comunidade acadêmica. " +
        "Inscrições gratuitas, vagas limitadas a 40 participantes. Traga seu notebook com Docker instalado.",
      data: daquiA(12),
      url: "https://ufla.br/"
    },
    {
      titulo: "Semana Acadêmica de Computação",
      descricao:
        "Palestras, minicursos e maratona de programação ao longo de cinco dias. " +
        "Certificado de horas complementares para quem participar de ao menos 75% das atividades.",
      data: daquiA(20, 9),
      url: "https://ufla.br/"
    },
    {
      titulo: "Edital de Monitoria — disciplinas de Exatas",
      descricao:
        "Seleção de monitores bolsistas e voluntários. Requisitos: ter cursado a disciplina com nota mínima 7,0 " +
        "e disponibilidade de 12 horas semanais. A bolsa é paga por 4 meses. Inscrição pelo sistema acadêmico.",
      data: daquiA(9),
      url: "https://ufla.br/"
    },
    {
      titulo: "Minicurso de Python para Análise de Dados",
      descricao:
        "Introdução a pandas e visualização de dados em três encontros. Indicado para estudantes de qualquer curso. " +
        "Pré-requisito: lógica de programação básica.",
      data: daquiA(15, 19),
      url: "https://ufla.br/"
    },
    {
      titulo: "Processo seletivo da Empresa Júnior de Tecnologia",
      descricao:
        "Seleção de novos membros para as áreas de projetos, marketing e gestão. Etapas: formulário, dinâmica em grupo " +
        "e entrevista. Aberto a estudantes a partir do segundo período.",
      data: daquiA(18),
      url: "https://ufla.br/"
    },
    {
      titulo: "Bolsa de Iniciação Científica em Agricultura Digital",
      descricao:
        "Projeto de pesquisa com sensores e aprendizado de máquina aplicados ao manejo de lavouras. " +
        "Bolsa de 12 meses com dedicação de 20 horas semanais. Envio de histórico escolar e carta de interesse.",
      data: daquiA(25),
      url: "https://ufla.br/"
    }
  ];
}
