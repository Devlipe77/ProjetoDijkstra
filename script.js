const KEY_SEP = "///";
const HISTORICO_KEY = "rotas_historico";
const MAX_HISTORICO = 5;
const VIZINHOS_NO_ESTADO = 8;
const ESTADOS_VIZINHOS_NO_PAIS = 3;
const PONTES_ENTRE_ESTADOS = 2;
const PAISES_VIZINHOS_POR_ESTADO = 1;

let cidadesPorLocal = {};
const cidades = {};
const grafo = {};
let map;
let rotaAtualLayer = null;
let marcadorOrigem = null;
let marcadorDestino = null;
let marcadorFoco = null;
let diretorioRelatorioHandle = null;

let caminhoGlobal = [];
let trechosGlobal = [];
let passoAtual = 0;
let ultimaConsulta = null;

function comporChave(pais, estado, cidade) {
    return [pais, estado, cidade].join(KEY_SEP);
}

function decomporChave(chave) {
    const [pais = "", estado = "", cidade = ""] = chave.split(KEY_SEP);
    return { pais, estado, cidade };
}

function nomeExibicao(chave) {
    return decomporChave(chave).cidade || chave;
}

function localExibicao(chave) {
    const { pais, estado, cidade } = decomporChave(chave);
    return `${cidade}, ${estado} - ${pais}`;
}

function ordenarNomes(lista) {
    return [...lista].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function formatarTimestampArquivo(data = new Date()) {
    const yyyy = data.getFullYear();
    const mm = String(data.getMonth() + 1).padStart(2, "0");
    const dd = String(data.getDate()).padStart(2, "0");
    const hh = String(data.getHours()).padStart(2, "0");
    const mi = String(data.getMinutes()).padStart(2, "0");
    const ss = String(data.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function sanitizarNomeArquivo(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[<>:"/\\|?*]+/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 80);
}

function formatarCoordenadas(coords) {
    return `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
}

function montarConteudoRelatorio(inicio, fim, distanciaTotal) {
    const origem = decomporChave(inicio);
    const destino = decomporChave(fim);
    const linhasRota = caminhoGlobal.map((chave, index) => {
        if (index === 0) {
            return `1. ${localExibicao(chave)} | trecho: 0 km | acumulado: 0 km`;
        }

        const anterior = caminhoGlobal[index - 1];
        const trecho = trechosGlobal[index];
        return `${index + 1}. ${localExibicao(anterior)} -> ${localExibicao(chave)} | trecho: ${trecho.kmTrecho} km | acumulado: ${trecho.kmAcumulado} km`;
    }).join("\n");

    return [
        "RELATORIO DE CONSULTA DE ROTA",
        `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
        "",
        "DADOS DE ORIGEM",
        `Pais: ${origem.pais}`,
        `Estado: ${origem.estado}`,
        `Cidade: ${origem.cidade}`,
        `Coordenadas: ${formatarCoordenadas(cidades[inicio])}`,
        "",
        "DADOS DE DESTINO",
        `Pais: ${destino.pais}`,
        `Estado: ${destino.estado}`,
        `Cidade: ${destino.cidade}`,
        `Coordenadas: ${formatarCoordenadas(cidades[fim])}`,
        "",
        `DISTANCIA TOTAL: ${distanciaTotal.toLocaleString("pt-BR")} km`,
        `TOTAL DE PONTOS NA ROTA: ${caminhoGlobal.length}`,
        "",
        "ROTA COM DISTANCIA PONTO A PONTO",
        linhasRota
    ].join("\n");
}

async function obterDiretorioRelatorio() {
    if (!window.showDirectoryPicker) return null;
    if (diretorioRelatorioHandle) return diretorioRelatorioHandle;

    diretorioRelatorioHandle = await window.showDirectoryPicker({
        mode: "readwrite"
    });

    return diretorioRelatorioHandle;
}

async function salvarRelatorioConsulta(inicio, fim, distanciaTotal) {
    const origem = decomporChave(inicio);
    const destino = decomporChave(fim);
    const timestamp = formatarTimestampArquivo();
    const nomeArquivo = [
        "relatorio",
        sanitizarNomeArquivo(origem.cidade),
        "para",
        sanitizarNomeArquivo(destino.cidade),
        timestamp
    ].join("_") + ".txt";
    const conteudo = montarConteudoRelatorio(inicio, fim, distanciaTotal);

    if (window.showDirectoryPicker) {
        try {
            const diretorio = await obterDiretorioRelatorio();
            if (!diretorio) return;

            const arquivo = await diretorio.getFileHandle(nomeArquivo, { create: true });
            const writer = await arquivo.createWritable();
            await writer.write(conteudo);
            await writer.close();
            return;
        } catch (erro) {
            console.warn("Nao foi possivel salvar o relatorio na pasta escolhida.", erro);
        }
    }

    const blob = new Blob([conteudo], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function carregarProjeto() {
    try {
        const resposta = await fetch("cidades.json");
        if (!resposta.ok) throw new Error("Nao foi possivel carregar o arquivo JSON.");

        cidadesPorLocal = await resposta.json();

        Object.entries(cidadesPorLocal).forEach(([pais, estados]) => {
            Object.entries(estados).forEach(([estado, cidadesEstado]) => {
                Object.entries(cidadesEstado).forEach(([cidade, coords]) => {
                    cidades[comporChave(pais, estado, cidade)] = coords;
                });
            });
        });

        inicializarMapa();
        construirGrafo();
        garantirConectividade();
        exibirEstatisticasGrafo();
        popularPaises();
        desenharMalhaViaria();
        renderizarHistorico();
    } catch (erro) {
        console.error("Erro critico:", erro);
        const res = document.getElementById("resultado");
        res.innerHTML = "<b style='color:#dc2626;'>Erro ao carregar dados do JSON. Verifique o servidor local.</b>";
        res.classList.add("ativo");
    }
}

function inicializarMapa() {
    const limitesAmericaDoSul = [
        [15, -92],
        [-60, -28]
    ];

    map = L.map("map", {
        zoomControl: false,
        minZoom: 3,
        maxZoom: 12,
        maxBounds: limitesAmericaDoSul,
        maxBoundsViscosity: 1
    }).setView([-21, -60], 4);

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap"
    }).addTo(map);
}

function calcularDistanciaKm(coord1, coord2) {
    const R = 6371;
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
    const dLon = (coord2[1] - coord1[1]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(coord1[0] * Math.PI / 180) *
        Math.cos(coord2[0] * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calcularCentroide(listaCidades) {
    const soma = listaCidades.reduce((acc, chave) => {
        acc[0] += cidades[chave][0];
        acc[1] += cidades[chave][1];
        return acc;
    }, [0, 0]);

    return [
        soma[0] / listaCidades.length,
        soma[1] / listaCidades.length
    ];
}

function montarEstadosInfo() {
    const estadosInfo = [];

    Object.entries(cidadesPorLocal).forEach(([pais, estados]) => {
        Object.keys(estados).forEach((estado) => {
            const chavesCidades = Object.keys(estados[estado]).map((cidade) => comporChave(pais, estado, cidade));

            if (chavesCidades.length === 0) return;

            estadosInfo.push({
                id: comporChave(pais, estado, ""),
                pais,
                estado,
                cidades: chavesCidades,
                centroide: calcularCentroide(chavesCidades)
            });
        });
    });

    return estadosInfo;
}

function adicionarAresta(origem, destino, distancia) {
    grafo[origem][destino] = distancia;
    grafo[destino][origem] = distancia;
}

function conectarCidadesDoMesmoEstado(infoEstado) {
    infoEstado.cidades.forEach((cidadeAtual) => {
        const vizinhos = infoEstado.cidades
            .filter((cidade) => cidade !== cidadeAtual)
            .map((vizinho) => ({
                nome: vizinho,
                dist: calcularDistanciaKm(cidades[cidadeAtual], cidades[vizinho])
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, VIZINHOS_NO_ESTADO);

        vizinhos.forEach((vizinho) => {
            adicionarAresta(cidadeAtual, vizinho.nome, vizinho.dist);
        });
    });
}

function encontrarPontesEntreEstados(infoA, infoB, quantidade) {
    const candidatos = [];

    infoA.cidades.forEach((cidadeA) => {
        infoB.cidades.forEach((cidadeB) => {
            candidatos.push({
                cidadeA,
                cidadeB,
                dist: calcularDistanciaKm(cidades[cidadeA], cidades[cidadeB])
            });
        });
    });

    const usadosA = new Set();
    const usadosB = new Set();
    const melhores = [];

    candidatos.sort((a, b) => a.dist - b.dist).forEach((candidato) => {
        if (melhores.length >= quantidade) return;
        if (usadosA.has(candidato.cidadeA) || usadosB.has(candidato.cidadeB)) return;

        melhores.push(candidato);
        usadosA.add(candidato.cidadeA);
        usadosB.add(candidato.cidadeB);
    });

    return melhores;
}

function conectarEstadosProximos(estadosInfo) {
    const paresConectados = new Set();

    function conectarPar(infoOrigem, infoDestino, quantidadePontes) {
        const chavePar = [infoOrigem.id, infoDestino.id].sort().join("::");
        if (paresConectados.has(chavePar)) return;

        encontrarPontesEntreEstados(infoOrigem, infoDestino, quantidadePontes).forEach((ponte) => {
            adicionarAresta(ponte.cidadeA, ponte.cidadeB, ponte.dist);
        });

        paresConectados.add(chavePar);
    }

    estadosInfo.forEach((infoOrigem) => {
        const vizinhosNoPais = estadosInfo
            .filter((infoDestino) => infoDestino.id !== infoOrigem.id && infoDestino.pais === infoOrigem.pais)
            .map((infoDestino) => ({
                info: infoDestino,
                dist: calcularDistanciaKm(infoOrigem.centroide, infoDestino.centroide)
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, ESTADOS_VIZINHOS_NO_PAIS);

        vizinhosNoPais.forEach((vizinho) => {
            conectarPar(infoOrigem, vizinho.info, PONTES_ENTRE_ESTADOS);
        });

        const vizinhosOutroPais = estadosInfo
            .filter((infoDestino) => infoDestino.pais !== infoOrigem.pais)
            .map((infoDestino) => ({
                info: infoDestino,
                dist: calcularDistanciaKm(infoOrigem.centroide, infoDestino.centroide)
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, PAISES_VIZINHOS_POR_ESTADO);

        vizinhosOutroPais.forEach((vizinho) => {
            conectarPar(infoOrigem, vizinho.info, 1);
        });
    });
}

function construirGrafo() {
    const listaCidades = Object.keys(cidades);
    listaCidades.forEach((cidade) => {
        grafo[cidade] = {};
    });

    const estadosInfo = montarEstadosInfo();

    estadosInfo.forEach((infoEstado) => {
        conectarCidadesDoMesmoEstado(infoEstado);
    });

    conectarEstadosProximos(estadosInfo);
}

function exibirEstatisticasGrafo() {
    const numVertices = Object.keys(grafo).length;
    let totalGraus = 0;
    let maxGrau = 0;

    for (const cidade in grafo) {
        const grauCidade = Object.keys(grafo[cidade]).length;
        totalGraus += grauCidade;
        if (grauCidade > maxGrau) maxGrau = grauCidade;
    }

    const numArestas = totalGraus / 2;
    const grauMedio = numVertices ? (totalGraus / numVertices).toFixed(1) : "0.0";

    document.getElementById("stat-vertices").innerText = numVertices;
    document.getElementById("stat-arestas").innerText = numArestas;
    document.getElementById("stat-grau-max").innerText = maxGrau;
    document.getElementById("stat-grau-med").innerText = grauMedio;
    document.getElementById("painel-stats").style.display = "block";
}

function popularPaises() {
    const selects = [
        document.getElementById("paisOrigem"),
        document.getElementById("paisDestino")
    ];

    ordenarNomes(Object.keys(cidadesPorLocal)).forEach((pais) => {
        selects.forEach((select) => select.add(new Option(pais, pais)));
    });

    document.getElementById("estadoOrigem").innerHTML = '<option value="">Estado...</option>';
    document.getElementById("estadoDestino").innerHTML = '<option value="">Estado...</option>';
    document.getElementById("cidadeOrigem").innerHTML = '<option value="">Cidade...</option>';
    document.getElementById("cidadeDestino").innerHTML = '<option value="">Cidade...</option>';
}

function atualizarEstados(tipo) {
    const pais = document.getElementById(`pais${tipo}`).value;
    const selectEstado = document.getElementById(`estado${tipo}`);
    const selectCidade = document.getElementById(`cidade${tipo}`);

    selectEstado.innerHTML = '<option value="">Estado...</option>';
    selectCidade.innerHTML = '<option value="">Cidade...</option>';
    selectCidade.disabled = true;

    if (!pais || !cidadesPorLocal[pais]) {
        selectEstado.disabled = true;
        return;
    }

    selectEstado.disabled = false;
    ordenarNomes(Object.keys(cidadesPorLocal[pais])).forEach((estado) => {
        selectEstado.add(new Option(estado, estado));
    });
}

function atualizarCidades(tipo) {
    const pais = document.getElementById(`pais${tipo}`).value;
    const estado = document.getElementById(`estado${tipo}`).value;
    const selectCidade = document.getElementById(`cidade${tipo}`);

    selectCidade.innerHTML = '<option value="">Cidade...</option>';

    if (!pais || !estado || !cidadesPorLocal[pais]?.[estado]) {
        selectCidade.disabled = true;
        return;
    }

    selectCidade.disabled = false;
    ordenarNomes(Object.keys(cidadesPorLocal[pais][estado])).forEach((cidade) => {
        selectCidade.add(new Option(cidade, comporChave(pais, estado, cidade)));
    });
}

function desenharMalhaViaria() {
    const conexoes = new Set();

    Object.keys(cidades).forEach((chave) => {
        L.circleMarker(cidades[chave], {
            radius: 4,
            color: "#3b82f6",
            fillColor: "#ffffff",
            fillOpacity: 1,
            weight: 2
        }).bindPopup(`<b>${localExibicao(chave)}</b>`).addTo(map);

        for (const vizinho in grafo[chave]) {
            const id = [chave, vizinho].sort().join("--");
            if (conexoes.has(id)) continue;

            L.polyline([cidades[chave], cidades[vizinho]], {
                color: "#7b7f87",
                weight: 1.2,
                opacity: 0.35,
                dashArray: "4, 4"
            }).addTo(map);

            conexoes.add(id);
        }
    });
}

function calcularRota() {
    const inicio = document.getElementById("cidadeOrigem").value;
    const fim = document.getElementById("cidadeDestino").value;
    const divResultado = document.getElementById("resultado");
    divResultado.classList.add("ativo");

    if (!inicio || !fim) {
        divResultado.innerHTML = "<b style='color:#dc2626;'>Erro:</b> Selecione pais, estado e cidade na origem e no destino.";
        return;
    }

    if (inicio === fim) {
        divResultado.innerHTML = "<b>Aviso:</b> Origem e destino sao o mesmo local.";
        return;
    }

    const distancias = {};
    const anteriores = {};
    const naoVisitados = new Set(Object.keys(grafo));

    Object.keys(grafo).forEach((no) => {
        distancias[no] = Infinity;
    });
    distancias[inicio] = 0;

    while (naoVisitados.size > 0) {
        let noAtual = null;
        for (const no of naoVisitados) {
            if (noAtual === null || distancias[no] < distancias[noAtual]) {
                noAtual = no;
            }
        }

        if (noAtual === null || distancias[noAtual] === Infinity || noAtual === fim) break;

        naoVisitados.delete(noAtual);

        for (const vizinho in grafo[noAtual]) {
            const novaDistancia = distancias[noAtual] + grafo[noAtual][vizinho];
            if (novaDistancia < distancias[vizinho]) {
                distancias[vizinho] = novaDistancia;
                anteriores[vizinho] = noAtual;
            }
        }
    }

    const caminho = [];
    let atual = fim;
    while (atual) {
        caminho.unshift(atual);
        atual = anteriores[atual];
    }

    if (caminho[0] !== inicio) {
        divResultado.innerHTML = "<b style='color:#dc2626;'>Erro:</b> Nao foi possivel encontrar uma rota valida.";
        return;
    }

    caminhoGlobal = caminho;
    passoAtual = 0;
    trechosGlobal = caminho.reduce((acc, chave, index) => {
        if (index === 0) {
            acc.push({ kmTrecho: 0, kmAcumulado: 0 });
            return acc;
        }

        const anterior = caminho[index - 1];
        const kmTrecho = grafo[anterior]?.[chave] ?? calcularDistanciaKm(cidades[anterior], cidades[chave]);
        acc.push({
            kmTrecho,
            kmAcumulado: acc[index - 1].kmAcumulado + kmTrecho
        });
        return acc;
    }, []);
    ultimaConsulta = { inicio, fim, distanciaTotal: distancias[fim] };

    if (marcadorOrigem) map.removeLayer(marcadorOrigem);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    if (marcadorFoco) map.removeLayer(marcadorFoco);
    if (rotaAtualLayer) map.removeLayer(rotaAtualLayer);

    marcadorOrigem = L.circleMarker(cidades[inicio], {
        radius: 6,
        weight: 4,
        color: "#02c415",
        fillColor: "#fff",
        fillOpacity: 1
    }).addTo(map).bindPopup(`<b>${localExibicao(inicio)}</b><br>Origem`);

    marcadorDestino = L.circleMarker(cidades[fim], {
        radius: 6,
        weight: 4,
        color: "#dc2626",
        fillColor: "#fff",
        fillOpacity: 1
    }).addTo(map).bindPopup(`<b>${localExibicao(fim)}</b><br>Destino`);

    rotaAtualLayer = L.polyline(caminho.map((cidade) => cidades[cidade]), {
        color: "#2563eb",
        weight: 3,
        opacity: 0.9,
        className: "rota-animada"
    }).addTo(map);

    renderizarPainelResultado(distancias[fim]);
    map.fitBounds(rotaAtualLayer.getBounds(), {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [450, 50]
    });

    marcadorOrigem.openPopup();
    salvarHistorico(inicio, fim, distancias[fim]);
}

function garantirConectividade() {
    const listaCidades = Object.keys(grafo);

    function bfs(inicio, visitados) {
        const fila = [inicio];
        visitados.add(inicio);

        while (fila.length > 0) {
            const atual = fila.shift();
            for (const vizinho in grafo[atual]) {
                if (!visitados.has(vizinho)) {
                    visitados.add(vizinho);
                    fila.push(vizinho);
                }
            }
        }
    }

    const visitadosGlobal = new Set();
    const componentes = [];

    for (const cidade of listaCidades) {
        if (visitadosGlobal.has(cidade)) continue;

        const componente = new Set();
        bfs(cidade, componente);
        componente.forEach((item) => visitadosGlobal.add(item));
        componentes.push(componente);
    }

    if (componentes.length <= 1) return;

    const principal = componentes.reduce((a, b) => (a.size > b.size ? a : b));

    componentes.forEach((componente) => {
        if (componente === principal) return;

        let melhorDist = Infinity;
        let melhorIsolada = null;
        let melhorPrincipal = null;

        for (const cidadeIsolada of componente) {
            for (const cidadePrincipal of principal) {
                const dist = calcularDistanciaKm(cidades[cidadeIsolada], cidades[cidadePrincipal]);
                if (dist < melhorDist) {
                    melhorDist = dist;
                    melhorIsolada = cidadeIsolada;
                    melhorPrincipal = cidadePrincipal;
                }
            }
        }

        if (!melhorIsolada || !melhorPrincipal) return;

        grafo[melhorIsolada][melhorPrincipal] = melhorDist;
        grafo[melhorPrincipal][melhorIsolada] = melhorDist;
    });
}

function renderizarPainelResultado(distanciaTotal) {
    const divResultado = document.getElementById("resultado");
    const textoCaminho = caminhoGlobal.map((chave, index) => {
        const nome = nomeExibicao(chave);
        return index === passoAtual ? `<span class="cidade-ativa">${nome}</span>` : nome;
    }).join(" <span style='color:#9ca3af;'>&rarr;</span> ");

    const pct = caminhoGlobal.length > 1
        ? Math.round((trechosGlobal[passoAtual].kmAcumulado / distanciaTotal) * 100)
        : 0;

    let cardTrecho = "";
    if (passoAtual === 0) {
        cardTrecho = `
            <div class="trecho-card trecho-origem">
                <span class="trecho-icone">Origem</span>
                <div class="trecho-info">
                    <span class="trecho-label">Ponto inicial</span>
                    <span class="trecho-cidade">${localExibicao(caminhoGlobal[0])}</span>
                </div>
                <span class="trecho-km trecho-km-zero">0 km</span>
            </div>`;
    } else if (passoAtual === caminhoGlobal.length - 1) {
        cardTrecho = `
            <div class="trecho-card trecho-destino">
                <span class="trecho-icone">Destino</span>
                <div class="trecho-info">
                    <span class="trecho-label">Chegada final</span>
                    <span class="trecho-cidade">${localExibicao(caminhoGlobal[passoAtual])}</span>
                </div>
                <span class="trecho-km">${distanciaTotal.toLocaleString("pt-BR")} km</span>
            </div>`;
    } else {
        const { kmTrecho, kmAcumulado } = trechosGlobal[passoAtual];
        cardTrecho = `
            <div class="trecho-card">
                <span class="trecho-icone">Parada</span>
                <div class="trecho-info">
                    <span class="trecho-label">+${kmTrecho} km do ponto anterior</span>
                    <span class="trecho-cidade">${localExibicao(caminhoGlobal[passoAtual])}</span>
                </div>
                <span class="trecho-km">${kmAcumulado.toLocaleString("pt-BR")} km acum.</span>
            </div>`;
    }

    divResultado.innerHTML = `
        <div class="badge-km">${distanciaTotal.toLocaleString("pt-BR")} km percurso</div><br>
        <span class="caminho-texto">${textoCaminho}</span>
        <div class="progresso-barra-wrap">
            <div class="progresso-barra" style="width:${pct}%"></div>
        </div>
        <div class="progresso-pct">${pct}% percorrido</div>
        ${cardTrecho}
    `;

    const fixos = document.getElementById("controles-fixos");
    fixos.style.display = "block";
    document.getElementById("btn-prev").disabled = passoAtual === 0;
    document.getElementById("btn-next").disabled = passoAtual === caminhoGlobal.length - 1;
    document.getElementById("passo-info-fixo").textContent = `Ponto ${passoAtual + 1} de ${caminhoGlobal.length}`;
    document.getElementById("btn-salvar-relatorio").style.display = "block";
}

function navegarPasso(direcao) {
    passoAtual += direcao;
    if (passoAtual < 0) passoAtual = 0;
    if (passoAtual >= caminhoGlobal.length) passoAtual = caminhoGlobal.length - 1;

    const chaveFocada = caminhoGlobal[passoAtual];
    const coord = cidades[chaveFocada];

    if (caminhoGlobal.length > 2) {
        map.flyTo(coord, 7, {
            animate: true,
            duration: 0.5,
            easeLinearity: 0.25
        });

        map.once("moveend", () => {
            if (marcadorFoco) map.removeLayer(marcadorFoco);

            if (chaveFocada === caminhoGlobal[0]) {
                marcadorOrigem.openPopup();
                visaoGeral();
            } else if (chaveFocada === caminhoGlobal[caminhoGlobal.length - 1]) {
                marcadorDestino.openPopup();
                visaoGeral();
            } else {
                marcadorFoco = L.circleMarker(coord, {
                    radius: 10,
                    color: "#f59e0b",
                    fillColor: "#fbbf24",
                    fillOpacity: 0.8,
                    weight: 3
                }).addTo(map);
                marcadorFoco.bindPopup(`<b>${localExibicao(chaveFocada)}</b><br>Parada ${passoAtual}`).openPopup();
            }
        });
    } else if (chaveFocada === caminhoGlobal[0]) {
        marcadorOrigem.openPopup();
    } else {
        marcadorDestino.openPopup();
    }

    const distanciaTotal = trechosGlobal[trechosGlobal.length - 1]?.kmAcumulado ?? 0;
    renderizarPainelResultado(distanciaTotal);
}

function salvarHistorico(inicio, fim, distancia) {
    const origem = decomporChave(inicio);
    const destino = decomporChave(fim);

    const entrada = {
        origemChave: inicio,
        destinoChave: fim,
        origemPais: origem.pais,
        origemEstado: origem.estado,
        origemNome: origem.cidade,
        destinoPais: destino.pais,
        destinoEstado: destino.estado,
        destinoNome: destino.cidade,
        distancia,
        data: new Date().toLocaleDateString("pt-BR")
    };

    let historico = carregarHistorico();
    historico = historico.filter((rota) => !(rota.origemChave === inicio && rota.destinoChave === fim));
    historico.unshift(entrada);
    if (historico.length > MAX_HISTORICO) historico.pop();

    localStorage.setItem(HISTORICO_KEY, JSON.stringify(historico));
    renderizarHistorico();
}

function carregarHistorico() {
    try {
        return JSON.parse(localStorage.getItem(HISTORICO_KEY)) || [];
    } catch {
        return [];
    }
}

function renderizarHistorico() {
    const historico = carregarHistorico();
    const container = document.getElementById("historico-lista");
    const secao = document.getElementById("historico-secao");

    if (historico.length === 0) {
        secao.style.display = "none";
        return;
    }

    secao.style.display = "block";
    container.innerHTML = historico.map((rota, index) => `
        <div class="historico-item" onclick="carregarRotaHistorico(${index})" title="Clique para recalcular">
            <div class="historico-cidades">
                <span class="hist-origem">${rota.origemNome}</span>
                <span class="hist-seta">&rarr;</span>
                <span class="hist-destino">${rota.destinoNome}</span>
            </div>
            <div class="historico-meta">
                <span class="hist-km">${rota.distancia.toLocaleString("pt-BR")} km</span>
                <span class="hist-data">${rota.data}</span>
            </div>
            <div class="historico-rota">${rota.origemEstado} / ${rota.origemPais} -> ${rota.destinoEstado} / ${rota.destinoPais}</div>
        </div>
    `).join("");
}

function carregarRotaHistorico(index) {
    const historico = carregarHistorico();
    const rota = historico[index];
    if (!rota) return;

    document.getElementById("paisOrigem").value = rota.origemPais;
    atualizarEstados("Origem");
    document.getElementById("estadoOrigem").value = rota.origemEstado;
    atualizarCidades("Origem");
    document.getElementById("cidadeOrigem").value = rota.origemChave;

    document.getElementById("paisDestino").value = rota.destinoPais;
    atualizarEstados("Destino");
    document.getElementById("estadoDestino").value = rota.destinoEstado;
    atualizarCidades("Destino");
    document.getElementById("cidadeDestino").value = rota.destinoChave;

    calcularRota();
}

function limparHistorico() {
    if (!confirm("Limpar todo o historico de rotas?")) return;
    localStorage.removeItem(HISTORICO_KEY);
    renderizarHistorico();
}

async function salvarRelatorioAtual() {
    if (!ultimaConsulta || caminhoGlobal.length === 0) {
        alert("Calcule uma rota antes de salvar o relatorio.");
        return;
    }

    try {
        await salvarRelatorioConsulta(
            ultimaConsulta.inicio,
            ultimaConsulta.fim,
            ultimaConsulta.distanciaTotal
        );
    } catch (erro) {
        console.warn("Falha ao gerar o relatorio da consulta.", erro);
    }
}

function visaoGeral() {
    if (!rotaAtualLayer) return;

    map.fitBounds(rotaAtualLayer.getBounds(), {
        paddingTopLeft: [50, 50],
        paddingBottomRight: [450, 50]
    });

    if (marcadorFoco) map.removeLayer(marcadorFoco);
}

window.onload = carregarProjeto;
