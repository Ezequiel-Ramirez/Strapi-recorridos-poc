import { factories } from '@strapi/strapi';

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
}));
