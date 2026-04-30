import { factories } from '@strapi/strapi';

const DOCUMENT_ID_REGEX = /^[a-z0-9]+$/i;

type TipoParada = 'agente' | 'subruta' | 'vacia';

interface RecorridoRef {
  documentId: string;
  codigo: string;
  descripcion: string;
}

interface TransportistaRef {
  documentId: string;
  IdTransportista: string;
  Descripcion: string;
}

interface AgenteDetalle {
  documentId: string;
  IdAgente: string;
  RazonSocial: string;
  Ciudad: string;
}

type DetalleParada = AgenteDetalle | RecorridoRef | null;

interface ParadaExpandida {
  ordenVisita: number;
  nombre: string;
  recorridoOrigen: RecorridoRef;
  tipo: TipoParada;
  detalle: DetalleParada;
  nivel: number;
  esDestinoBuscado: boolean;
  agentesDestino?: AgenteDetalle[]; // MIRROR: src/admin/extensions/components/AsignarAgente/types.ts
}

interface HojaDeRuta {
  recorridoRaiz: RecorridoRef;
  transportista: TransportistaRef | null;
  paradasExpandidas: ParadaExpandida[];
  warnings?: string[];
}

const toRecorridoRef = (r: any): RecorridoRef => ({
  documentId: r.documentId,
  codigo: r.codigo,
  descripcion: r.descripcion,
});

const toTransportistaRef = (t: any): TransportistaRef | null =>
  t
    ? {
        documentId: t.documentId,
        IdTransportista: t.IdTransportista,
        Descripcion: t.Descripcion,
      }
    : null;

const toAgenteDetalle = (a: any): AgenteDetalle => ({
  documentId: a.documentId,
  IdAgente: a.IdAgente,
  RazonSocial: a.RazonSocial,
  Ciudad: a.Ciudad,
});

export default factories.createCoreService('api::recorrido.recorrido', ({ strapi }) => ({
  async resolverHojaDeRutaPorAgente(agenteDocumentId: string): Promise<HojaDeRuta[]> {
    const agente = await strapi
      .documents('api::agente.agente')
      .findOne({ documentId: agenteDocumentId });

    if (!agente) {
      const err: any = new Error(`Agente ${agenteDocumentId} no encontrado`);
      err.status = 404;
      throw err;
    }

    const paradasDelAgente = await strapi.documents('api::parada.parada').findMany({
      filters: { destino_agente: { documentId: agenteDocumentId } },
      populate: { recorrido: true },
    });

    if (paradasDelAgente.length === 0) return [];

    const warningsGlobales: string[] = [];
    const raicesPorDocId = new Map<string, { recorridoId: string; warnings: string[] }>();

    for (const parada of paradasDelAgente as any[]) {
      const recorridoInicial = parada.recorrido;
      if (!recorridoInicial) continue;

      const visitedAscenso = new Set<string>();
      const warningsLocal: string[] = [];
      const raiz = await this.ascenderHastaRaiz(
        recorridoInicial,
        visitedAscenso,
        warningsLocal,
      );

      if (!raicesPorDocId.has(raiz.documentId)) {
        raicesPorDocId.set(raiz.documentId, {
          recorridoId: raiz.documentId,
          warnings: warningsLocal,
        });
      } else {
        const existing = raicesPorDocId.get(raiz.documentId)!;
        existing.warnings.push(...warningsLocal);
      }
    }

    const hojas: HojaDeRuta[] = [];
    for (const { recorridoId, warnings } of raicesPorDocId.values()) {
      const visitedDFS = new Set<string>();
      const hoja = await this.expandirDesdeRaiz(
        recorridoId,
        agenteDocumentId,
        visitedDFS,
        [...warnings, ...warningsGlobales],
      );
      if (hoja) hojas.push(hoja);
    }

    return hojas;
  },

  async ascenderHastaRaiz(
    recorrido: any,
    visited: Set<string>,
    warnings: string[],
  ): Promise<{ documentId: string; codigo: string; descripcion: string }> {
    if (visited.has(recorrido.documentId)) {
      warnings.push(`Ciclo detectado en ascenso desde ${recorrido.codigo}`);
      return recorrido;
    }
    visited.add(recorrido.documentId);

    const padres = await strapi.documents('api::parada.parada').findMany({
      filters: { destino_recorrido: { documentId: recorrido.documentId } },
      populate: { recorrido: true },
    });

    if (padres.length === 0) return recorrido;

    if (padres.length > 1) {
      const codigos = padres
        .map((p: any) => p.recorrido?.codigo)
        .filter(Boolean)
        .join(', ');
      const msg = `Recorrido ${recorrido.codigo} tiene múltiples padres (${codigos}); se toma el primero`;
      strapi.log.warn(msg);
      warnings.push(msg);
    }

    const padre = (padres[0] as any).recorrido;
    if (!padre) return recorrido;

    return this.ascenderHastaRaiz(padre, visited, warnings);
  },

  async expandirDesdeRaiz(
    recorridoDocumentId: string,
    agenteDocumentId: string,
    visited: Set<string>,
    warnings: string[],
  ): Promise<HojaDeRuta | null> {
    const raiz = await strapi.documents('api::recorrido.recorrido').findOne({
      documentId: recorridoDocumentId,
      populate: { transportista: true },
    });

    if (!raiz) return null;

    const paradasExpandidas: ParadaExpandida[] = [];
    await this.expandirRecursivo(
      recorridoDocumentId,
      agenteDocumentId,
      visited,
      0,
      paradasExpandidas,
      warnings,
    );

    return {
      recorridoRaiz: toRecorridoRef(raiz),
      transportista: toTransportistaRef((raiz as any).transportista),
      paradasExpandidas,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async expandirRecursivo(
    recorridoDocumentId: string,
    agenteDocumentId: string,
    visited: Set<string>,
    nivel: number,
    acc: ParadaExpandida[],
    warnings: string[],
  ): Promise<void> {
    if (visited.has(recorridoDocumentId)) {
      warnings.push(`Ciclo detectado al expandir ${recorridoDocumentId}; se omite subruta`);
      return;
    }
    visited.add(recorridoDocumentId);

    const recorrido = await strapi.documents('api::recorrido.recorrido').findOne({
      documentId: recorridoDocumentId,
      populate: {
        paradas: {
          populate: {
            destino_agente: true,
            destino_recorrido: true,
          },
        },
      },
    });

    if (!recorrido) return;

    const recorridoOrigen: RecorridoRef = toRecorridoRef(recorrido);
    const paradas = ((recorrido as any).paradas ?? []).slice().sort(
      (a: any, b: any) => Number(a.ordenVisita) - Number(b.ordenVisita),
    );

    for (const parada of paradas as any[]) {
      const tieneAgente = !!parada.destino_agente;
      const tieneSubruta = !!parada.destino_recorrido;

      let tipo: TipoParada;
      let detalle: DetalleParada;

      if (tieneAgente) {
        tipo = 'agente';
        detalle = toAgenteDetalle(parada.destino_agente);
      } else if (tieneSubruta) {
        tipo = 'subruta';
        detalle = toRecorridoRef(parada.destino_recorrido);
      } else {
        tipo = 'vacia';
        detalle = null;
      }

      acc.push({
        ordenVisita: Number(parada.ordenVisita),
        nombre: parada.nombre,
        recorridoOrigen,
        tipo,
        detalle,
        nivel,
        esDestinoBuscado:
          tieneAgente && parada.destino_agente.documentId === agenteDocumentId,
      });

      if (tieneSubruta) {
        await this.expandirRecursivo(
          parada.destino_recorrido.documentId,
          agenteDocumentId,
          visited,
          nivel + 1,
          acc,
          warnings,
        );
      }
    }
  },

  // ─── Multi-agent twin functions (NFR-2: do not modify mono-agent originals) ───

  async expandirRecursivoMulti(
    recorridoDocumentId: string,
    agentes: Map<string, AgenteDetalle>,
    visited: Set<string>,
    nivel: number,
    acc: ParadaExpandida[],
    warnings: string[],
  ): Promise<void> {
    if (visited.has(recorridoDocumentId)) {
      warnings.push(`Ciclo detectado al expandir ${recorridoDocumentId}; se omite subruta`);
      return;
    }
    visited.add(recorridoDocumentId);

    const recorrido = await strapi.documents('api::recorrido.recorrido').findOne({
      documentId: recorridoDocumentId,
      populate: {
        paradas: {
          populate: {
            destino_agente: true,
            destino_recorrido: true,
          },
        },
      },
    });

    if (!recorrido) return;

    const recorridoOrigen: RecorridoRef = toRecorridoRef(recorrido);
    const paradas = ((recorrido as any).paradas ?? []).slice().sort(
      (a: any, b: any) => Number(a.ordenVisita) - Number(b.ordenVisita),
    );

    for (const parada of paradas as any[]) {
      const tieneAgente = !!parada.destino_agente;
      const tieneSubruta = !!parada.destino_recorrido;

      let tipo: TipoParada;
      let detalle: DetalleParada;

      if (tieneAgente) {
        tipo = 'agente';
        detalle = toAgenteDetalle(parada.destino_agente);
      } else if (tieneSubruta) {
        tipo = 'subruta';
        detalle = toRecorridoRef(parada.destino_recorrido);
      } else {
        tipo = 'vacia';
        detalle = null;
      }

      const agentesDestino: AgenteDetalle[] = [];
      if (tieneAgente) {
        const candidato = agentes.get(parada.destino_agente.documentId);
        if (candidato) agentesDestino.push(candidato);
      }

      acc.push({
        ordenVisita: Number(parada.ordenVisita),
        nombre: parada.nombre,
        recorridoOrigen,
        tipo,
        detalle,
        nivel,
        esDestinoBuscado: agentesDestino.length >= 1,
        agentesDestino,
      });

      if (tieneSubruta) {
        await this.expandirRecursivoMulti(
          parada.destino_recorrido.documentId,
          agentes,
          visited,
          nivel + 1,
          acc,
          warnings,
        );
      }
    }
  },

  async expandirDesdeRaizMulti(
    recorridoDocumentId: string,
    agentes: Map<string, AgenteDetalle>,
    visited: Set<string>,
    warnings: string[],
  ): Promise<HojaDeRuta | null> {
    const raiz = await strapi.documents('api::recorrido.recorrido').findOne({
      documentId: recorridoDocumentId,
      populate: { transportista: true },
    });

    if (!raiz) return null;

    const paradasExpandidas: ParadaExpandida[] = [];
    await this.expandirRecursivoMulti(
      recorridoDocumentId,
      agentes,
      visited,
      0,
      paradasExpandidas,
      warnings,
    );

    return {
      recorridoRaiz: toRecorridoRef(raiz),
      transportista: toTransportistaRef((raiz as any).transportista),
      paradasExpandidas,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },

  async resolverHojaDeRutaPorAgentes(
    ids: string[],
  ): Promise<{ data: HojaDeRuta[]; agentesNoEncontrados: string[] }> {
    // ───── 1. Validación e input cleanup ─────
    if (!Array.isArray(ids) || ids.length === 0) {
      const err: any = new Error('agentes debe ser un array no vacío');
      err.status = 400;
      throw err;
    }
    for (const id of ids) {
      if (typeof id !== 'string' || !DOCUMENT_ID_REGEX.test(id)) {
        const err: any = new Error(`documentId inválido: ${id}`);
        err.status = 400;
        throw err;
      }
    }
    // dedup preservando orden de primera aparición
    const idsUnicos = Array.from(new Set(ids));

    // ───── 2. Resolución de agentes ─────
    const agentesEncontrados = await strapi.documents('api::agente.agente').findMany({
      filters: { documentId: { $in: idsUnicos } },
    });
    const agentesPorDocId = new Map<string, AgenteDetalle>(
      (agentesEncontrados as any[]).map((a) => [a.documentId, toAgenteDetalle(a)]),
    );
    const agentesNoEncontrados: string[] = idsUnicos.filter(
      (id) => !agentesPorDocId.has(id),
    );

    if (agentesPorDocId.size === 0) {
      return { data: [], agentesNoEncontrados };
    }

    // ───── 3. Una sola query $in para todas las paradas iniciales ─────
    const idsExistentes = Array.from(agentesPorDocId.keys());
    const paradasIniciales = await strapi.documents('api::parada.parada').findMany({
      filters: { destino_agente: { documentId: { $in: idsExistentes } } },
      populate: { recorrido: true, destino_agente: true },
    });

    const agentesConParada = new Set<string>(
      (paradasIniciales as any[])
        .map((p) => p.destino_agente?.documentId)
        .filter(Boolean),
    );
    for (const id of idsExistentes) {
      if (!agentesConParada.has(id)) agentesNoEncontrados.push(id);
    }

    // ───── 4. Ascenso a raíz construyendo Map<rootDocId, Set<agenteDocId>> ─────
    const agentesPorRaiz = new Map<string, Set<string>>();
    const warningsPorRaiz = new Map<string, string[]>();

    for (const parada of paradasIniciales as any[]) {
      const recorridoInicial = parada.recorrido;
      const agenteId = parada.destino_agente?.documentId;
      if (!recorridoInicial || !agenteId) continue;

      const visitedAscenso = new Set<string>();
      const warningsLocal: string[] = [];
      const raiz = await this.ascenderHastaRaiz(recorridoInicial, visitedAscenso, warningsLocal);

      if (!agentesPorRaiz.has(raiz.documentId)) {
        agentesPorRaiz.set(raiz.documentId, new Set());
        warningsPorRaiz.set(raiz.documentId, []);
      }
      agentesPorRaiz.get(raiz.documentId)!.add(agenteId);
      warningsPorRaiz.get(raiz.documentId)!.push(...warningsLocal);
    }

    // ───── 5. Una sola expansión DFS por raíz única ─────
    const hojas: HojaDeRuta[] = [];
    for (const [rootDocId, agenteIdSet] of agentesPorRaiz.entries()) {
      const visitedDFS = new Set<string>();
      const warnings = warningsPorRaiz.get(rootDocId) ?? [];

      const agentesDeRaiz = new Map<string, AgenteDetalle>();
      for (const id of agenteIdSet) {
        const detalle = agentesPorDocId.get(id);
        if (detalle) agentesDeRaiz.set(id, detalle);
      }

      const hoja = await this.expandirDesdeRaizMulti(rootDocId, agentesDeRaiz, visitedDFS, warnings);
      if (hoja) hojas.push(hoja);
    }

    // ───── 6. Orden estable: por recorridoRaiz.codigo ascendente ─────
    hojas.sort((a, b) =>
      a.recorridoRaiz.codigo.localeCompare(b.recorridoRaiz.codigo, undefined, { numeric: true }),
    );

    return { data: hojas, agentesNoEncontrados };
  },
}));
