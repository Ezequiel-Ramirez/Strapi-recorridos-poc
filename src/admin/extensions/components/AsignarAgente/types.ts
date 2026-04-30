export type TipoParada = 'agente' | 'subruta' | 'vacia';

export interface RecorridoRef {
  documentId: string;
  codigo: string;
  descripcion: string;
}

export interface TransportistaRef {
  documentId: string;
  IdTransportista: string;
  Descripcion: string;
}

export interface AgenteDetalle {
  documentId: string;
  IdAgente: string;
  RazonSocial: string;
  Ciudad: string;
}

export type DetalleParada = AgenteDetalle | RecorridoRef | null;

export interface ParadaExpandida {
  ordenVisita: number;
  nombre: string;
  recorridoOrigen: RecorridoRef;
  tipo: TipoParada;
  detalle: DetalleParada;
  nivel: number;
  esDestinoBuscado: boolean;
  agentesDestino?: AgenteDetalle[];
}

export interface HojaDeRuta {
  recorridoRaiz: RecorridoRef;
  transportista: TransportistaRef | null;
  paradasExpandidas: ParadaExpandida[];
  warnings?: string[];
}

export interface HojaDeRutaResponse {
  data: HojaDeRuta[];
}

export interface MultiAgenteResponse {
  data: HojaDeRuta[];
  agentesNoEncontrados: string[];
}
