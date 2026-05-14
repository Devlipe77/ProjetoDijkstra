// =============================================================================
// VARIÁVEIS GLOBAIS
// =============================================================================

// Armazena o JSON completo com municípios agrupados por estado: { "SP": { "São Paulo": [lat, lon], ... }, ... }
let cidadesPorEstado = {};

// Dicionário plano de cidades com chave composta "UF/NomeCidade" → [lat, lon]
// Ex: { "SP/São Paulo": [-23.5505, -46.6333], ... }
const cidades = {};

// Grafo de adjacência ponderado: { "SP/São Paulo": { "SP/Campinas": 98, ... }, ... }
// Cada aresta armazena a distância em km entre dois municípios conectados
const grafo = {};

// Instância principal do mapa Leaflet
let map;

// Layer Leaflet da rota atualmente desenhada no mapa (polyline azul)
let rotaAtualLayer;

// Array ordenado com as chaves "UF/Cidade" de cada ponto da rota calculada
// Ex: ["SP/São Paulo", "SP/Campinas", "MG/Poços de Caldas"]
let caminhoGlobal = [];

// Índice do passo atualmente destacado na navegação ponto a ponto (começa em 0)
let passoAtual = 0;

// Marcador amarelo temporário que destaca a cidade do passo atual durante a navegação
let marcadorFoco = null;

// Array paralelo a caminhoGlobal com dados de distância de cada passo
// Cada elemento: { kmTrecho: number, kmAcumulado: number }
let trechosGlobal = [];

// Marcador verde do ponto de origem no mapa
let marcadorOrigem;

// Marcador vermelho do ponto de destino no mapa
let marcadorDestino;


// =============================================================================
// UTILITÁRIOS
// =============================================================================

/**
 * Extrai o nome de exibição de uma chave composta "UF/Cidade".
 * Se a chave contiver "/", retorna apenas a parte após o separador.
 * Se não contiver "/", retorna a chave inteira (fallback seguro).
 *
 * @param {string} chave - Ex: "SP/São Paulo" ou "Brasília"
 * @returns {string} - Ex: "São Paulo" ou "Brasília"
 */
function nomeExibicao(chave) {
    return chave.includes('/') ? chave.split('/')[1] : chave;
}


// =============================================================================
// CARREGAMENTO INICIAL DO PROJETO
// =============================================================================

/**
 * Ponto de entrada da aplicação — executado automaticamente ao carregar a página.
 * Faz o fetch do arquivo JSON de cidades, popula as estruturas de dados globais
 * e dispara todas as funções de inicialização em sequência.
 *
 * Fluxo:
 *   1. Busca ../model/cidades.json via fetch
 *   2. Popula `cidadesPorEstado` com o JSON bruto
 *   3. Desmembra o JSON em `cidades` (chave "UF/Nome" → [lat, lon])
 *   4. Inicializa o mapa Leaflet
 *   5. Constrói o grafo de adjacência por proximidade geográfica
 *   6. Garante que o grafo seja completamente conectado (sem ilhas isoladas)
 *   7. Exibe estatísticas do grafo no painel lateral
 *   8. Popula os <select> de estado/cidade
 *   9. Desenha a malha viária (pontos + arestas) no mapa
 *  10. Renderiza o histórico de rotas salvo no localStorage
 */
async function carregarProjeto() {
    try {
        // Requisição HTTP ao arquivo JSON local
        const resposta = await fetch('../model/cidades.json');

        // Lança erro se o servidor retornar status diferente de 2xx
        if (!resposta.ok) throw new Error("Não foi possível carregar o arquivo JSON.");

        // Deserializa o JSON e armazena na variável global cidadesPorEstado
        cidadesPorEstado = await resposta.json();

        // Achata a estrutura aninhada { UF: { nome: coords } } em um objeto plano { "UF/nome": coords }
        Object.entries(cidadesPorEstado).forEach(([uf, estado]) => {
            Object.entries(estado).forEach(([nome, coords]) => {
                cidades[`${uf}/${nome}`] = coords; // chave composta garante unicidade entre estados
            });
        });

        // Inicializa o tile map do Leaflet no elemento <div id="map">
        inicializarMapa();

        // Cria todas as arestas do grafo com base em proximidade geográfica
        construirGrafo();

        // Conecta eventuais componentes desconexos para garantir que toda rota seja calculável
        garantirConectividade();

        // Atualiza o painel de estatísticas (vértices, arestas, grau máximo, grau médio)
        exibirEstatisticasGrafo();

        // Preenche os <select> de UF e inicializa os placeholders de cidade
        popularEstados();

        // Desenha círculos (cidades) e linhas tracejadas (arestas) no mapa
        desenharMalhaViaria();

        // Lê o localStorage e renderiza o histórico de rotas calculadas anteriormente
        renderizarHistorico();

    } catch (erro) {
        // Log do erro completo no console para debugging
        console.error("Erro crítico:", erro);

        // Exibe mensagem de erro visível ao usuário no painel de resultado
        const res = document.getElementById('resultado');
        res.innerHTML = "<b style='color:#dc2626;'>Erro ao carregar dados do JSON. Verifique o servidor local.</b>";
        res.classList.add('ativo'); // torna o painel visível via CSS
    }
}


// =============================================================================
// ESTATÍSTICAS DO GRAFO
// =============================================================================

/**
 * Percorre o grafo para calcular métricas e exibi-las no painel de estatísticas.
 *
 * Métricas calculadas:
 * - Número de vértices (municípios carregados)
 * - Número de arestas (conexões únicas entre municípios)
 * - Grau máximo (cidade com mais vizinhos diretos)
 * - Grau médio (média de vizinhos por cidade)
 *
 * O número de arestas é obtido dividindo a soma dos graus por 2,
 * pois cada aresta é contada duas vezes (uma para cada extremidade).
 */
function exibirEstatisticasGrafo() {
    // Total de vértices = total de chaves no grafo
    const numVertices = Object.keys(grafo).length;

    let totalGraus = 0; // soma de todos os graus (cada aresta conta 2x)
    let maxGrau = 0;    // maior grau encontrado

    for (let cidade in grafo) {
        // Grau da cidade = número de vizinhos diretos na lista de adjacência
        const grauDaCidade = Object.keys(grafo[cidade]).length;
        totalGraus += grauDaCidade;

        // Atualiza o máximo se esta cidade tiver mais conexões que o registro atual
        if (grauDaCidade > maxGrau) {
            maxGrau = grauDaCidade;
        }
    }

    // Cada aresta aparece duas vezes no somatório de graus (uma por extremidade)
    const numArestas = totalGraus / 2;

    // Grau médio arredondado para 1 casa decimal
    const grauMedio = (totalGraus / numVertices).toFixed(1);

    // Atualiza os elementos de texto no DOM do painel de estatísticas
    document.getElementById('stat-vertices').innerText = numVertices;
    document.getElementById('stat-arestas').innerText = numArestas;
    document.getElementById('stat-grau-max').innerText = maxGrau;
    document.getElementById('stat-grau-med').innerText = grauMedio;

    // Torna o painel visível (estava oculto via CSS antes dos dados serem carregados)
    document.getElementById('painel-stats').style.display = 'block';
}


// =============================================================================
// CÁLCULO DE DISTÂNCIA GEOGRÁFICA
// =============================================================================

/**
 * Calcula a distância em linha reta (em km) entre dois pontos geográficos
 * usando a fórmula de Haversine, que considera a curvatura da Terra.
 *
 * A fórmula é precisa para distâncias de qualquer magnitude e amplamente
 * utilizada em sistemas de navegação e GIS.
 *
 * @param {number[]} coord1 - Array [latitude, longitude] do ponto A (graus decimais)
 * @param {number[]} coord2 - Array [latitude, longitude] do ponto B (graus decimais)
 * @returns {number} Distância arredondada em quilômetros (inteiro)
 */
function calcularDistanciaKm(coord1, coord2) {
    const R = 6371; // Raio médio da Terra em quilômetros

    // Converte a diferença de latitudes de graus para radianos
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;

    // Converte a diferença de longitudes de graus para radianos
    const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;

    // Calcula o quadrado do semi-comprimento da corda entre os dois pontos
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(coord1[0] * Math.PI / 180) *   // cosseno da latitude do ponto A
        Math.cos(coord2[0] * Math.PI / 180) *   // cosseno da latitude do ponto B
        Math.sin(dLon / 2) ** 2;

    // Aplica atan2 para obter o ângulo central e multiplica pelo raio para obter a distância
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}


// =============================================================================
// CONSTRUÇÃO DO GRAFO DE ADJACÊNCIA
// =============================================================================

/**
 * Constrói o grafo de adjacência conectando cada município aos seus 5 vizinhos
 * mais próximos em linha reta. As arestas são bidirecionais e ponderadas pela
 * distância em km.
 *
 * Estratégia:
 * - Para cada cidade, calcula a distância para todas as demais
 * - Ordena essas distâncias em ordem crescente
 * - Mantém apenas as 5 menores (os 5 vizinhos mais próximos)
 * - Adiciona aresta em ambas as direções (grafo não-dirigido)
 *
 * Complexidade: O(n²) onde n = número de cidades — aceitável para ~1.200 municípios.
 *
 * Observação: Ao final desta função, o grafo pode estar desconexo (ex: ilhas como
 * Fernando de Noronha). A função `garantirConectividade()` resolve esse problema.
 */
function construirGrafo() {
    const listaCidades = Object.keys(cidades);

    // Inicializa a lista de adjacência de cada cidade como um objeto vazio
    listaCidades.forEach(c => grafo[c] = {});

    listaCidades.forEach(cidadeAtual => {
        // Calcula a distância de cidadeAtual para todos os outros municípios,
        // ordena pelo menor valor e pega apenas os 5 primeiros (mais próximos)
        let distancias = listaCidades
            .filter(c => c !== cidadeAtual) // exclui a própria cidade
            .map(vizinho => ({
                nome: vizinho,
                dist: calcularDistanciaKm(cidades[cidadeAtual], cidades[vizinho])
            }))
            .sort((a, b) => a.dist - b.dist) // ordena crescente por distância
            .slice(0, 5); // mantém apenas os 5 mais próximos

        // Adiciona aresta nos dois sentidos (grafo não-dirigido)
        distancias.forEach(v => {
            grafo[cidadeAtual][v.nome] = v.dist; // cidadeAtual → vizinho
            grafo[v.nome][cidadeAtual] = v.dist; // vizinho → cidadeAtual
        });
    });
}


// =============================================================================
// INICIALIZAÇÃO DO MAPA (LEAFLET)
// =============================================================================

/**
 * Cria e configura a instância do mapa Leaflet com restrições geográficas
 * para manter o foco no território brasileiro.
 *
 * Configurações notáveis:
 * - zoomControl: false → os botões +/- padrão são removidos e reposicionados
 * - maxBounds → impede que o usuário arraste o mapa para fora do Brasil
 * - maxBoundsViscosity: 1.0 → torna o limite absolutamente rígido (sem elástico)
 */
function inicializarMapa() {
    // Caixa delimitadora (bounding box) aproximada do território brasileiro
    const limitesBrasil = [
        [15.0, -90.0],   // Canto superior-esquerdo: extremo norte/oeste (acima de Roraima)
        [-45.0, -20.0]   // Canto inferior-direito: extremo sul/leste (abaixo do RS)
    ];

    map = L.map('map', {
        zoomControl: false,           // Desativa controle de zoom padrão (será reposicionado)
        minZoom: 4,                   // Zoom mínimo: impede visão de todo o globo
        maxBounds: limitesBrasil,     // Restringe a área arrastável ao Brasil
        maxBoundsViscosity: 1.0       // 1.0 = limite completamente rígido (sem efeito elástico)
    }).setView([-15.7938, -47.8828], 5); // Centraliza em Brasília com zoom inicial 5

    // Reposiciona o controle +/- no canto inferior esquerdo (longe do painel lateral)
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Adiciona o tile layer usando o tema "light_all" do CartoCDN (fundo claro, discreto)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
}


// =============================================================================
// POPULAMENTO DOS SELECTS DE ESTADO E CIDADE
// =============================================================================

/**
 * Preenche os dois <select> de estado (origem e destino) com os UFs disponíveis
 * no JSON, ordenados alfabeticamente.
 * Também inicializa o texto placeholder dos selects de cidade.
 */
function popularEstados() {
    const selects = [
        document.getElementById('estadoOrigem'),
        document.getElementById('estadoDestino')
    ];

    // Itera sobre as siglas de estado em ordem alfabética e adiciona uma <option> em ambos os selects
    Object.keys(cidadesPorEstado).sort().forEach(uf => {
        selects.forEach(s => s.add(new Option(uf, uf)));
    });

    // Define o texto exibido antes de o usuário escolher uma cidade
    document.getElementById('cidadeOrigem').options[0].text = "Cidade...";
    document.getElementById('cidadeDestino').options[0].text = "Cidade...";
}

/**
 * Atualiza o <select> de cidades de acordo com o estado selecionado.
 * Chamada pelo evento onChange dos selects de estado (origem ou destino).
 *
 * @param {string} tipo - "Origem" ou "Destino" — define qual par de selects atualizar
 */
function atualizarCidades(tipo) {
    // Lê o UF selecionado no select de estado correspondente ao tipo
    const uf = document.getElementById(`estado${tipo}`).value;
    const selectCidade = document.getElementById(`cidade${tipo}`);

    // Limpa as opções anteriores e adiciona o placeholder padrão
    selectCidade.innerHTML = '<option value="">Cidade...</option>';

    if (uf && cidadesPorEstado[uf]) {
        // Habilita o select e adiciona as cidades do estado selecionado em ordem alfabética
        selectCidade.disabled = false;
        Object.keys(cidadesPorEstado[uf]).sort().forEach(nome => {
            // O value de cada <option> é a chave composta "UF/Cidade" usada internamente no grafo
            selectCidade.add(new Option(nome, `${uf}/${nome}`));
        });
    } else {
        // Desabilita o select de cidade se nenhum estado válido estiver selecionado
        selectCidade.disabled = true;
    }
}


// =============================================================================
// RENDERIZAÇÃO DA MALHA VIÁRIA NO MAPA
// =============================================================================

/**
 * Desenha no mapa todos os municípios (como círculos azuis) e todas as conexões
 * do grafo (como linhas tracejadas cinza).
 *
 * Usa um Set para garantir que cada aresta seja desenhada uma única vez,
 * evitando linhas duplicadas (já que o grafo é não-dirigido e cada aresta
 * aparece nos dois sentidos).
 *
 * Complexidade visual: O(V + E) onde V = vértices e E = arestas.
 */
function desenharMalhaViaria() {
    // Conjunto de IDs de arestas já desenhadas para evitar duplicatas
    // ID de aresta = as duas chaves ordenadas e concatenadas com "-"
    let setConexoes = new Set();

    Object.keys(cidades).forEach(chave => {
        const nome = nomeExibicao(chave); // nome legível para o popup

        // Adiciona um marcador circular no mapa para cada município
        L.circleMarker(cidades[chave], {
            radius: 4,
            color: '#3b82f6',      // cor da borda (azul)
            fillColor: '#ffffff',  // preenchimento branco
            fillOpacity: 1,
            weight: 2              // espessura da borda em pixels
        })
            .bindPopup(`<b>${nome}</b>`) // popup com nome ao clicar
            .addTo(map);

        // Itera sobre todos os vizinhos desta cidade no grafo
        for (let vizinho in grafo[chave]) {
            // Gera um ID único para esta aresta, independente da direção
            const id = [chave, vizinho].sort().join('-');

            if (!setConexoes.has(id)) {
                // Desenha a linha tracejada entre as duas cidades
                L.polyline([cidades[chave], cidades[vizinho]], {
                    color: '#7b7f87',      // cinza neutro
                    weight: 1.5,           // espessura fina
                    opacity: 0.4,          // semi-transparente para não poluir o mapa
                    dashArray: '4, 4'      // padrão tracejado: 4px cheio, 4px vazio
                }).addTo(map);

                setConexoes.add(id); // marca como desenhada
            }
        }
    });
}


// =============================================================================
// ALGORITMO DE DIJKSTRA — CÁLCULO DO MENOR CAMINHO
// =============================================================================

/**
 * Calcula a rota de menor distância entre origem e destino usando o algoritmo
 * de Dijkstra com busca linear pelo nó de menor custo (implementação O(V²)).
 *
 * Após o cálculo:
 * - Exibe a rota no mapa como uma polyline azul sólida
 * - Posiciona marcadores de origem (verde) e destino (vermelho)
 * - Renderiza o painel de resultado com distância total e navegação passo a passo
 * - Salva a rota no histórico do localStorage
 */
function calcularRota() {
    // Lê os valores dos selects de cidade (chaves compostas "UF/Nome")
    const inicio = document.getElementById('cidadeOrigem').value;
    const fim = document.getElementById('cidadeDestino').value;
    const divResultado = document.getElementById('resultado');

    // Garante que o painel de resultado seja visível
    divResultado.classList.add('ativo');

    // Validações básicas antes de executar o algoritmo
    if (!inicio || !fim)
        return divResultado.innerHTML = "<b style='color:#dc2626;'>Erro:</b> Selecione origem e destino completos.";
    if (inicio === fim)
        return divResultado.innerHTML = "<b>Aviso:</b> Origem e destino são o mesmo local.";

    // ── Inicialização do Dijkstra ─────────────────────────────────────────────

    const distancias = {};  // distância mínima conhecida da origem até cada nó
    const anteriores = {};  // nó predecessor no menor caminho até cada nó
    const naoVisitados = new Set(Object.keys(grafo)); // conjunto de nós ainda não processados

    // Inicializa todas as distâncias como infinito (desconhecido)
    Object.keys(grafo).forEach(no => distancias[no] = Infinity);

    // A distância da origem para ela mesma é zero
    distancias[inicio] = 0;

    // ── Loop principal do Dijkstra ────────────────────────────────────────────
    while (naoVisitados.size > 0) {
        // Seleciona o nó não visitado com menor distância acumulada (busca linear O(V))
        let noAtual = null;
        for (let no of naoVisitados) {
            if (noAtual === null || distancias[no] < distancias[noAtual]) noAtual = no;
        }

        // Para se chegou ao destino ou se todos os nós restantes são inacessíveis
        if (distancias[noAtual] === Infinity || noAtual === fim) break;

        // Remove o nó atual dos não-visitados (marca como processado)
        naoVisitados.delete(noAtual);

        // Relaxamento: tenta melhorar a distância para cada vizinho
        for (let vizinho in grafo[noAtual]) {
            let novaDistancia = distancias[noAtual] + grafo[noAtual][vizinho];
            if (novaDistancia < distancias[vizinho]) {
                distancias[vizinho] = novaDistancia; // atualiza distância mínima
                anteriores[vizinho] = noAtual;       // registra predecessor no caminho ótimo
            }
        }
    }

    // ── Reconstrução do caminho ───────────────────────────────────────────────
    // Reconstrói o caminho percorrendo os predecessores de trás para frente
    let caminho = [];
    let atual = fim;
    while (atual) {
        caminho.unshift(atual); // insere no início para obter ordem origem→destino
        atual = anteriores[atual];
    }

    // Armazena o caminho globalmente para uso na navegação passo a passo
    caminhoGlobal = caminho;

    // Calcula os dados de distância por trecho para exibição no painel
    trechosGlobal = caminho.reduce((acc, chave, i) => {
        if (i === 0) {
            // Ponto de origem: distância zero
            acc.push({ kmTrecho: 0, kmAcumulado: 0 });
            return acc;
        }
        const anterior = caminho[i - 1];
        // Usa o peso da aresta do grafo; recalcula caso a aresta não exista (fallback)
        const kmTrecho = grafo[anterior]?.[chave] ?? calcularDistanciaKm(cidades[anterior], cidades[chave]);
        const kmAcumulado = acc[i - 1].kmAcumulado + kmTrecho;
        acc.push({ kmTrecho, kmAcumulado });
        return acc;
    }, []);

    // Persiste a rota no histórico do localStorage
    salvarHistorico(inicio, fim, distancias[fim]);

    // ── Atualização dos marcadores de origem/destino ──────────────────────────

    // Remove os marcadores anteriores do mapa, se existirem
    if (marcadorOrigem) map.removeLayer(marcadorOrigem);
    if (marcadorDestino) map.removeLayer(marcadorDestino);

    const cidadeInicio = caminho[0];
    const cidadeFim = caminho[caminho.length - 1];

    // Marcador verde para a cidade de origem
    marcadorOrigem = L.circleMarker(cidades[cidadeInicio], {
        radius: 6,
        weight: 4,
        color: '#02c415',    // verde
        fillColor: '#fff',
        fillOpacity: 1
    }).addTo(map).bindPopup(`<b>📍 ${nomeExibicao(cidadeInicio)}</b><br>Origem`);

    // Marcador vermelho para a cidade de destino
    marcadorDestino = L.circleMarker(cidades[cidadeFim], {
        radius: 6,
        weight: 4,
        color: '#dc2626',    // vermelho
        fillColor: '#fff',
        fillOpacity: 1
    }).addTo(map).bindPopup(`<b>📍 ${nomeExibicao(cidadeFim)}</b><br>Destino`);

    // Reseta a navegação para o primeiro passo (ponto de origem)
    passoAtual = 0;

    // Renderiza o painel com distância total e controles de passo
    renderizarPainelResultado(distancias[fim]);

    // ── Desenho da rota no mapa ───────────────────────────────────────────────

    // Remove a rota anterior se existir
    if (rotaAtualLayer) map.removeLayer(rotaAtualLayer);

    // Desenha a polyline azul conectando todos os pontos do caminho
    rotaAtualLayer = L.polyline(caminho.map(c => cidades[c]), {
        color: '#2563eb',  // azul
        weight: 3,
        opacity: 0.9,
        className: 'rota-animada' // classe CSS para animação de traço
    }).addTo(map);

    // Ajusta o zoom do mapa para enquadrar toda a rota,
    // com padding para não ficar atrás do painel lateral (direita)
    map.fitBounds(rotaAtualLayer.getBounds(), {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [450, 50] // 450px à direita = largura do painel de controles
    });

    // Remove qualquer marcador de foco de navegação anterior
    if (marcadorFoco) map.removeLayer(marcadorFoco);

    // Abre o popup do marcador de origem automaticamente
    marcadorOrigem.openPopup();
}


// =============================================================================
// CONECTIVIDADE DO GRAFO (BFS)
// =============================================================================

/**
 * Verifica se o grafo é completamente conectado e, caso não seja,
 * cria pontes entre os componentes desconexos para garantir que
 * qualquer par de cidades seja alcançável pelo algoritmo de Dijkstra.
 *
 * Algoritmo:
 * 1. Executa BFS a partir de cada cidade não visitada → identifica componentes
 * 2. Se houver mais de um componente, encontra o par de cidades mais próximo
 *    entre o componente principal (maior) e cada componente isolado
 * 3. Adiciona uma aresta direta entre esse par para unir os componentes
 *
 * Casos reais onde isso ocorre: municípios de ilhas (Fernando de Noronha,
 * Ilha de Marajó) que ficam isolados por distância excessiva dos 5 vizinhos.
 */
function garantirConectividade() {
    const listaCidades = Object.keys(grafo);

    /**
     * BFS auxiliar que explora todo o componente conectado a partir de `inicio`
     * e adiciona os nós visitados ao Set `visitados`.
     */
    function bfs(inicio, visitados) {
        const fila = [inicio];
        visitados.add(inicio);
        while (fila.length > 0) {
            const atual = fila.shift(); // remove o primeiro elemento da fila
            for (let vizinho in grafo[atual]) {
                if (!visitados.has(vizinho)) {
                    visitados.add(vizinho);
                    fila.push(vizinho); // enfileira vizinho para exploração futura
                }
            }
        }
    }

    // ── Identificação dos componentes ─────────────────────────────────────────
    const visitadosGlobal = new Set(); // cidades já atribuídas a algum componente
    const componentes = [];           // lista de Sets, cada um representando um componente

    for (let cidade of listaCidades) {
        if (!visitadosGlobal.has(cidade)) {
            // Cidade ainda não explorada → inicia um novo componente via BFS
            const componente = new Set();
            bfs(cidade, componente);
            componente.forEach(c => visitadosGlobal.add(c)); // marca como visitadas globalmente
            componentes.push(componente);
        }
    }

    // Grafo já conectado: nada a fazer
    if (componentes.length <= 1) return;

    console.warn(`Grafo desconexo: ${componentes.length} componentes encontrados. Conectando...`);

    // O componente principal é o maior (mais cidades)
    const principal = componentes.reduce((a, b) => a.size > b.size ? a : b);

    // ── Conexão dos componentes isolados ao principal ─────────────────────────
    componentes.forEach(comp => {
        if (comp === principal) return; // pula o componente principal

        let melhorDist = Infinity;
        let melhorIsolada = null;
        let melhorPrincipal = null;

        // Busca o par (cidadeIsolada, cidadePrincipal) com menor distância entre si
        for (let cidadeIsolada of comp) {
            for (let cidadePrincipal of principal) {
                const dist = calcularDistanciaKm(cidades[cidadeIsolada], cidades[cidadePrincipal]);
                if (dist < melhorDist) {
                    melhorDist = dist;
                    melhorIsolada = cidadeIsolada;
                    melhorPrincipal = cidadePrincipal;
                }
            }
        }

        // Adiciona aresta bidirecional entre os dois componentes (ponte)
        grafo[melhorIsolada][melhorPrincipal] = melhorDist;
        grafo[melhorPrincipal][melhorIsolada] = melhorDist;

        console.info(`Ponte criada: ${nomeExibicao(melhorIsolada)} ↔ ${nomeExibicao(melhorPrincipal)} (${melhorDist} km)`);
    });
}


// =============================================================================
// RENDERIZAÇÃO DO PAINEL DE RESULTADO E NAVEGAÇÃO PASSO A PASSO
// =============================================================================

/**
 * Renderiza o painel de resultado com o caminho completo, barra de progresso,
 * card de trecho atual e controles de navegação passo a passo.
 *
 * Esta função é chamada tanto após calcular uma nova rota quanto ao
 * navegar entre os passos (navegarPasso), reutilizando `caminhoGlobal`,
 * `passoAtual` e `trechosGlobal`.
 *
 * @param {number} distanciaTotal - Distância total da rota em km
 */
function renderizarPainelResultado(distanciaTotal) {
    const divResultado = document.getElementById('resultado');

    // Gera a sequência de nomes de cidades, destacando a cidade do passo atual com CSS
    const textoCaminho = caminhoGlobal.map((chave, index) => {
        const nome = nomeExibicao(chave);
        if (index === passoAtual)
            return `<span class="cidade-ativa">${nome}</span>`; // destaque visual
        return nome;
    }).join(" <span style='color:#9ca3af;'>➔</span> "); // seta cinza entre cidades

    // Calcula o percentual percorrido com base na distância acumulada do passo atual
    const pct = caminhoGlobal.length > 1
        ? Math.round((trechosGlobal[passoAtual].kmAcumulado / distanciaTotal) * 100)
        : 0;

    // ── Geração do card de trecho (varia conforme o passo atual) ─────────────
    let cardTrecho = '';

    if (passoAtual === 0) {
        // Passo 0: ponto de origem — sem distância percorrida ainda
        cardTrecho = `
            <div class="trecho-card trecho-origem">
                <span class="trecho-icone">🟢</span>
                <div class="trecho-info">
                    <span class="trecho-label">Ponto de Origem</span>
                    <span class="trecho-cidade">${nomeExibicao(caminhoGlobal[0])}</span>
                </div>
                <span class="trecho-km trecho-km-zero">0 km</span>
            </div>`;

    } else if (passoAtual === caminhoGlobal.length - 1) {
        // Último passo: destino final — exibe distância total
        cardTrecho = `
            <div class="trecho-card trecho-destino">
                <span class="trecho-icone">🔴</span>
                <div class="trecho-info">
                    <span class="trecho-label">Destino Final</span>
                    <span class="trecho-cidade">${nomeExibicao(caminhoGlobal[passoAtual])}</span>
                </div>
                <span class="trecho-km">${distanciaTotal.toLocaleString('pt-BR')} km</span>
            </div>`;

    } else {
        // Passo intermediário: exibe km do trecho atual e km acumulado desde a origem
        const { kmTrecho, kmAcumulado } = trechosGlobal[passoAtual];
        const anterior = nomeExibicao(caminhoGlobal[passoAtual - 1]);
        cardTrecho = `
            <div class="trecho-card">
                <span class="trecho-icone">📍</span>
                <div class="trecho-info">
                    <span class="trecho-label">+${kmTrecho} km de ${anterior}</span>
                    <span class="trecho-cidade">${nomeExibicao(caminhoGlobal[passoAtual])}</span>
                </div>
                <span class="trecho-km">${kmAcumulado.toLocaleString('pt-BR')} km acum.</span>
            </div>`;
    }

    // ── Montagem do HTML final do painel ──────────────────────────────────────
    divResultado.innerHTML = `
        <div class="badge-km">${distanciaTotal.toLocaleString('pt-BR')} km percurso</div><br>
        <span class="caminho-texto">${textoCaminho}</span>

        <!-- Barra de progresso visual (largura proporcional ao % percorrido) -->
        <div class="progresso-barra-wrap">
            <div class="progresso-barra" style="width:${pct}%"></div>
        </div>
        <div class="progresso-pct">${pct}% percorrido</div>

        ${cardTrecho}
    `;

    // ── Atualização dos controles fixos de navegação ──────────────────────────
    const fixos = document.getElementById('controles-fixos');
    fixos.style.display = 'block'; // torna os botões Anterior/Próximo visíveis

    // Desabilita "Anterior" no primeiro passo e "Próximo" no último
    document.getElementById('btn-prev').disabled = passoAtual === 0;
    document.getElementById('btn-next').disabled = passoAtual === caminhoGlobal.length - 1;

    // Atualiza o contador "Ponto X de Y"
    document.getElementById('passo-info-fixo').textContent =
        `Ponto ${passoAtual + 1} de ${caminhoGlobal.length}`;
}

/**
 * Avança ou retrocede um passo na navegação da rota e centraliza o mapa
 * na cidade correspondente com animação de voo (flyTo).
 *
 * Comportamento especial:
 * - Passos intermediários: exibe marcador amarelo com popup
 * - Primeiro ou último passo: abre popup do marcador de origem/destino
 *   e volta à visão geral da rota completa
 * - Rotas com apenas 2 cidades: pula o flyTo (não há cidades intermediárias)
 *
 * @param {number} direcao - +1 para avançar, -1 para voltar
 */
function navegarPasso(direcao) {
    // Atualiza o passo e clamp nos limites [0, tamanho-1]
    passoAtual += direcao;
    if (passoAtual < 0) passoAtual = 0;
    if (passoAtual >= caminhoGlobal.length) passoAtual = caminhoGlobal.length - 1;

    const chaveFocada = caminhoGlobal[passoAtual]; // chave "UF/Cidade" do passo atual
    const coord = cidades[chaveFocada];            // coordenadas [lat, lon] da cidade

    if (caminhoGlobal.length > 2) {
        // Voa suavemente até a cidade com zoom 9 e animação de 0.5s
        map.flyTo(coord, 9, {
            animate: true,
            duration: 0.5,
            easeLinearity: 0.25 // aceleração suave
        });

        // Executa após o fim da animação de voo para evitar conflitos de posição
        map.once('moveend', function () {
            if (marcadorFoco) map.removeLayer(marcadorFoco); // remove foco anterior

            if (chaveFocada !== caminhoGlobal[caminhoGlobal.length - 1] &&
                chaveFocada !== caminhoGlobal[0]) {
                // Cidade intermediária: adiciona marcador amarelo com popup
                marcadorFoco = L.circleMarker(coord, {
                    radius: 10,
                    color: '#f59e0b',       // laranja/âmbar
                    fillColor: '#fbbf24',
                    fillOpacity: 0.8,
                    weight: 3
                }).addTo(map);
                marcadorFoco
                    .bindPopup(`<b>${nomeExibicao(chaveFocada)}</b><br>Parada ${passoAtual}`)
                    .openPopup();

            } else if (chaveFocada === caminhoGlobal[caminhoGlobal.length - 1]) {
                // Chegou ao destino: abre popup vermelho e volta à visão geral
                marcadorDestino.openPopup();
                visaoGeral();

            } else if (chaveFocada === caminhoGlobal[0]) {
                // Voltou à origem: abre popup verde e volta à visão geral
                marcadorOrigem.openPopup();
                visaoGeral();
            }
        });

    } else {
        // Rota direta (só origem e destino): apenas abre o popup sem voar
        if (chaveFocada === caminhoGlobal[caminhoGlobal.length - 1]) {
            marcadorDestino.openPopup();
        } else if (chaveFocada === caminhoGlobal[0]) {
            marcadorOrigem.openPopup();
        }
    }

    // Atualiza o painel de resultado com o novo passo destacado
    renderizarPainelResultado(
        document.querySelector('.badge-km').innerText.replace(/[^0-9]/g, '')
    );
}

/**
 * Ajusta o zoom do mapa para enquadrar toda a rota calculada,
 * respeitando o padding do painel lateral (450px à direita).
 * Também remove o marcador de foco de passo atual, se existir.
 */
function visaoGeral() {
    map.fitBounds(rotaAtualLayer.getBounds(), {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [450, 50] // margem direita para não sobrepor o painel
    });

    // Remove o marcador amarelo de passo intermediário do mapa
    if (marcadorFoco) map.removeLayer(marcadorFoco);
}


// =============================================================================
// HISTÓRICO DE ROTAS (localStorage)
// =============================================================================

// Chave utilizada para leitura/escrita no localStorage
const HISTORICO_KEY = 'rotas_historico';

// Número máximo de rotas mantidas no histórico (as mais antigas são descartadas)
const MAX_HISTORICO = 5;

/**
 * Persiste uma rota calculada no histórico do localStorage.
 * Garante que não haja duplicatas (mesma origem + destino) e limita
 * o tamanho da lista a MAX_HISTORICO entradas, descartando as mais antigas.
 *
 * @param {string} inicio - Chave composta "UF/Cidade" da origem
 * @param {string} fim    - Chave composta "UF/Cidade" do destino
 * @param {number} distancia - Distância total da rota em km
 */
function salvarHistorico(inicio, fim, distancia) {
    // Monta o objeto de entrada com todos os dados necessários para reexibição
    const entrada = {
        origemChave: inicio,           // chave interna (ex: "SP/São Paulo")
        destinoChave: fim,             // chave interna (ex: "MG/Belo Horizonte")
        origemUF: inicio.split('/')[0],  // sigla do estado de origem
        destinoUF: fim.split('/')[0],    // sigla do estado de destino
        origemNome: nomeExibicao(inicio),  // nome legível da origem
        destinoNome: nomeExibicao(fim),    // nome legível do destino
        distancia,                         // distância total em km
        data: new Date().toLocaleDateString('pt-BR') // data da consulta (ex: "15/07/2025")
    };

    let historico = carregarHistorico();

    // Remove entrada duplicada com a mesma origem e destino (se existir)
    historico = historico.filter(r =>
        !(r.origemChave === inicio && r.destinoChave === fim)
    );

    // Insere a nova entrada no início da lista (mais recente primeiro)
    historico.unshift(entrada);

    // Descarta a entrada mais antiga se ultrapassar o limite
    if (historico.length > MAX_HISTORICO) historico.pop();

    // Persiste o array atualizado no localStorage como string JSON
    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));

    // Atualiza imediatamente a UI do histórico
    renderizarHistorico();
}

/**
 * Lê e desserializa o histórico de rotas do localStorage.
 * Retorna um array vazio se não houver dados ou se o JSON estiver corrompido.
 *
 * @returns {Array} Lista de objetos de rota do histórico
 */
function carregarHistorico() {
    try {
        return JSON.parse(localStorage.getItem(HISTORICO_KEY)) || [];
    } catch {
        return []; // fallback seguro em caso de JSON inválido
    }
}

/**
 * Renderiza a seção de histórico de rotas no painel lateral.
 * Oculta a seção se não houver rotas salvas.
 * Cada item é clicável e recalcula a rota ao ser clicado.
 */
function renderizarHistorico() {
    const historico = carregarHistorico();
    const container = document.getElementById('historico-lista');
    const secao = document.getElementById('historico-secao');

    // Oculta a seção inteira se o histórico estiver vazio
    if (historico.length === 0) {
        secao.style.display = 'none';
        return;
    }

    secao.style.display = 'block';

    // Gera um card HTML para cada entrada do histórico
    container.innerHTML = historico.map((r, i) => `
        <div class="historico-item" onclick="carregarRotaHistorico(${i})" title="Clique para recalcular">
            <div class="historico-cidades">
                <span class="hist-origem">${r.origemNome}</span>
                <span class="hist-seta">→</span>
                <span class="hist-destino">${r.destinoNome}</span>
            </div>
            <div class="historico-meta">
                <span class="hist-km">${r.distancia.toLocaleString('pt-BR')} km</span>
                <span class="hist-data">${r.data}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Carrega uma rota do histórico nos selects de estado/cidade e recalcula.
 * Simula exatamente o mesmo fluxo que o usuário faria manualmente.
 *
 * @param {number} index - Índice da entrada no array do histórico (0 = mais recente)
 */
function carregarRotaHistorico(index) {
    const historico = carregarHistorico();
    const rota = historico[index];

    // Seleciona o estado de origem e atualiza as cidades disponíveis
    const selEstadoOrigem = document.getElementById('estadoOrigem');
    selEstadoOrigem.value = rota.origemUF;
    atualizarCidades('Origem');
    document.getElementById('cidadeOrigem').value = rota.origemChave;

    // Seleciona o estado de destino e atualiza as cidades disponíveis
    const selEstadoDestino = document.getElementById('estadoDestino');
    selEstadoDestino.value = rota.destinoUF;
    atualizarCidades('Destino');
    document.getElementById('cidadeDestino').value = rota.destinoChave;

    // Dispara o cálculo da rota como se o usuário tivesse clicado no botão
    calcularRota();
}

/**
 * Limpa todo o histórico de rotas do localStorage após confirmação do usuário.
 * Atualiza a UI imediatamente para refletir a exclusão.
 */
function limparHistorico() {
    if (!confirm('Limpar todo o histórico de rotas?')) return;
    localStorage.removeItem(HISTORICO_KEY);
    renderizarHistorico(); // atualiza a UI (oculta a seção de histórico)
}


// =============================================================================
// INICIALIZAÇÃO
// =============================================================================

// Aguarda o carregamento completo do DOM antes de iniciar a aplicação
window.onload = carregarProjeto;