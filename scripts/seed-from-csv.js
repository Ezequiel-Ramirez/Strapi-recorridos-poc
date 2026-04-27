'use strict';

const fs = require('fs');
const path = require('path');

// Ruta al backup más reciente (30-01) — accesible desde WSL via mount de Windows
const CSV_DIR =
  '/mnt/c/Users/eeramirez/OneDrive - S.A. La Nacion/Escritorio/Backup-Strapi-circu-DEV-30-01';

// ---------------------------------------------------------------------------
// CSV parser (maneja campos quoted, comas dentro de quotes, \r\n de Windows)
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else if (ch !== '\r') {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines
    .slice(1)
    .map((line) => {
      const values = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
      return obj;
    })
    .filter((row) => row[headers[0]] !== '');
}

// ---------------------------------------------------------------------------
// Helpers de conversión de tipos
// ---------------------------------------------------------------------------
const toBool   = (v) => v === '1' || v === 'true';
const toStr    = (v) => (v === '' ? null : String(v));
const toReqStr = (v) => String(v ?? ''); // campos required: nunca null, fallback ''
const toInt    = (v) => (v === '' ? null : parseInt(v, 10));

// ---------------------------------------------------------------------------
// Mapeo de columnas V4 (snake_case DB) → campos V5 schema (PascalCase)
//
// Columnas ignoradas intencionalmente:
//   agente: habilitado_flasheo, puede_solicitar_modificacion_carga
//           (existen en V4 pero no en el schema V5 del POC)
//   todos:  id, created_at, updated_at, created_by_id, updated_by_id
//           (Strapi los genera automáticamente)
// ---------------------------------------------------------------------------
function mapTransportista(row) {
  return {
    IdTransportista: toStr(row.id_transportista),
    Descripcion:     toStr(row.descripcion),
  };
}

function mapAgente(row) {
  return {
    // required: true → toReqStr (nunca null, fallback '')
    IdAgente:    toReqStr(row.id_agente),
    RazonSocial: toReqStr(row.razon_social),
    IdAgenteSap: toReqStr(row.id_agente_sap),
    Domicilio:   toReqStr(row.domicilio),
    Ciudad:      toReqStr(row.ciudad),
    Provincia:   toReqStr(row.provincia),
    Activo:      toBool(row.activo),
    // optional → toStr (null si vacío)
    Email:          toStr(row.email),
    IdAgentePadre:  toStr(row.id_agente_padre),
    IdGrupoCliente: toStr(row.id_grupo_cliente),
    GrupoCuenta:    toStr(row.grupo_cuenta),
    HabilitadoRepo: toBool(row.habilitado_repo),
    Cuit:           toStr(row.cuit),
    AgenteRediaf:   toBool(row.agente_rediaf),
    AgenteExcluido: toBool(row.agente_excluido),
  };
}

function mapRecorrido(row) {
  return {
    codigo:          toStr(row.codigo),
    descripcion:     toStr(row.descripcion),
    puntoExpedicion: toStr(row.punto_expedicion) || 'NO APLICA',
    activa:          toBool(row.activa),
    rutaImpreso:     toStr(row.ruta_impreso),
    lunes:    toBool(row.lunes),
    martes:   toBool(row.martes),
    miercoles: toBool(row.miercoles),
    jueves:   toBool(row.jueves),
    viernes:  toBool(row.viernes),
    sabado:   toBool(row.sabado),
    domingo:  toBool(row.domingo),
  };
}

function mapParada(row) {
  return {
    ordenVisita: toInt(row.orden_visita),
  };
}

// ---------------------------------------------------------------------------
// Parseo de tablas de links (relaciones V4 — usan IDs numéricos)
// ---------------------------------------------------------------------------
function buildLinkMap(filePath, keyCol, valCol) {
  // Devuelve Map<keyCol_value, valCol_value> (one-to-one)
  const rows = parseCSV(filePath);
  const map = new Map();
  for (const row of rows) {
    map.set(row[keyCol], row[valCol]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Importación en batches concurrentes para no saturar SQLite
// ---------------------------------------------------------------------------
async function importInBatches(label, items, importFn, batchSize = 50) {
  let done = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(importFn));
    done += batch.length;
    process.stdout.write(`\r  ${done}/${items.length}`);
  }
  console.log(`\r  ✓ ${done} ${label} importados`);
}

// ---------------------------------------------------------------------------
// Importadores por entidad
// Cada uno devuelve un Map<v4_id_string, documentId_v5>
// ---------------------------------------------------------------------------

async function importTransportistas() {
  console.log('\nImportando transportistas...');
  const rows = parseCSV(path.join(CSV_DIR, 'transportistas_202601301608.csv'));
  const idMap = new Map(); // v4 id → documentId

  await importInBatches('transportistas', rows, async (row) => {
    try {
      const doc = await strapi.documents('api::transportista.transportista').create({
        data:   mapTransportista(row),
        status: row.published_at ? 'published' : 'draft',
      });
      idMap.set(row.id, doc.documentId);
    } catch (err) {
      console.error(`\n  [WARN] transportista id=${row.id}: ${err.message}`);
    }
  });

  return idMap;
}

async function importAgentes() {
  console.log('\nImportando agentes...');
  const rows = parseCSV(path.join(CSV_DIR, 'agentes_202601301608.csv'));
  const idMap = new Map();

  await importInBatches('agentes', rows, async (row) => {
    try {
      const doc = await strapi.documents('api::agente.agente').create({
        data:   mapAgente(row),
        status: row.published_at ? 'published' : 'draft',
      });
      idMap.set(row.id, doc.documentId);
    } catch (err) {
      console.error(`\n  [WARN] agente id=${row.id} (${row.id_agente}): ${err.message}`);
    }
  });

  return idMap;
}

async function importRecorridos(transportistaIdMap) {
  console.log('\nImportando recorridos...');
  const rows = parseCSV(path.join(CSV_DIR, 'recorridos_202601301608.csv'));

  // Links: recorrido_id → transportista_id (V4)
  const recorridoTransportistaLinks = buildLinkMap(
    path.join(CSV_DIR, 'recorridos_transportista_links_202601301608.csv'),
    'recorrido_id',
    'transportista_id',
  );

  const idMap = new Map();

  await importInBatches('recorridos', rows, async (row) => {
    try {
      const data = mapRecorrido(row);

      // Resolver la relación transportista usando el mapa de V4→V5
      const v4TransportistaId = recorridoTransportistaLinks.get(row.id);
      if (v4TransportistaId) {
        const transportistaDocId = transportistaIdMap.get(v4TransportistaId);
        if (transportistaDocId) {
          data.transportista = transportistaDocId;
        }
      }

      // recorrido tiene draftAndPublish=false → siempre published, no se pasa status
      const doc = await strapi.documents('api::recorrido.recorrido').create({ data });
      idMap.set(row.id, doc.documentId);
    } catch (err) {
      console.error(`\n  [WARN] recorrido id=${row.id} (${row.codigo}): ${err.message}`);
    }
  });

  return idMap;
}

async function importParadas(recorridoIdMap, agenteIdMap) {
  console.log('\nImportando paradas...');
  const rows = parseCSV(path.join(CSV_DIR, 'paradas_202601301608.csv'));

  // Links de paradas
  const paradaAgenteLinks = buildLinkMap(
    path.join(CSV_DIR, 'paradas_destino_agente_links_202601301608.csv'),
    'parada_id',
    'agente_id',
  );
  const paradaDestinoRecorridoLinks = buildLinkMap(
    path.join(CSV_DIR, 'paradas_destino_recorrido_links_202601301608.csv'),
    'parada_id',
    'recorrido_id',
  );
  const paradaRecorridoLinks = buildLinkMap(
    path.join(CSV_DIR, 'paradas_recorrido_links_202601301608.csv'),
    'parada_id',
    'recorrido_id',
  );

  await importInBatches('paradas', rows, async (row) => {
    try {
      const data = mapParada(row);

      // Relación recorrido padre (manyToOne — lado dueño de la relación)
      const v4RecorridoId = paradaRecorridoLinks.get(row.id);
      if (v4RecorridoId) {
        const recorridoDocId = recorridoIdMap.get(v4RecorridoId);
        if (recorridoDocId) data.recorrido = recorridoDocId;
      }

      // Relación destino_agente (oneToOne)
      const v4AgenteId = paradaAgenteLinks.get(row.id);
      if (v4AgenteId) {
        const agenteDocId = agenteIdMap.get(v4AgenteId);
        if (agenteDocId) data.destino_agente = agenteDocId;
      }

      // Relación destino_recorrido (oneToOne)
      const v4DestinoRecorridoId = paradaDestinoRecorridoLinks.get(row.id);
      if (v4DestinoRecorridoId) {
        const destinoDocId = recorridoIdMap.get(v4DestinoRecorridoId);
        if (destinoDocId) data.destino_recorrido = destinoDocId;
      }

      // parada tiene draftAndPublish=false → no se pasa status
      await strapi.documents('api::parada.parada').create({ data });
    } catch (err) {
      console.error(`\n  [WARN] parada id=${row.id}: ${err.message}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  try {
    // Orden respeta dependencias de relaciones
    const transportistaIdMap = await importTransportistas();
    const agenteIdMap         = await importAgentes();
    const recorridoIdMap      = await importRecorridos(transportistaIdMap);
    await importParadas(recorridoIdMap, agenteIdMap);

    console.log('\n✓ Seed desde CSV completado.');
  } catch (err) {
    console.error('\nError durante el seed:', err);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
