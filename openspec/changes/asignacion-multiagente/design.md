# Design — Asignación Multi-Agente en Modal AsignarAgente

**Change**: `asignacion-multiagente`
**Project**: `strapi-recorridos-poc`
**Phase**: design
**Status**: archived

> Este documento es el HOW arquitectónico. Las decisiones del proposal están cerradas; aquí se traducen a contratos concretos: tipos, firmas de funciones, flujo de datos, puntos de integración. Las **tasks** vendrán después y descompondrán esto en pasos ejecutables.

---

## 1. Type changes

### 1.1 `ParadaExpandida` — extensión backward-compatible

**Antes** (en `src/api/recorrido/services/recorrido.ts` y `src/admin/extensions/components/AsignarAgente/types.ts`):

```ts
interface ParadaExpandida {
  ordenVisita: number;
  nombre: string;
  recorridoOrigen: RecorridoRef;
  tipo: TipoParada;
  detalle: DetalleParada;
  nivel: number;
  esDestinoBuscado: boolean;
}
```

**Después** (mismo lugar, ambos archivos):

```ts
interface ParadaExpandida {
  ordenVisita: number;
  nombre: string;
  recorridoOrigen: RecorridoRef;
  tipo: TipoParada;
  detalle: DetalleParada;
  nivel: number;
  esDestinoBuscado: boolean;          // se mantiene como boolean (back-compat)
  agentesDestino?: AgenteDetalle[];   // NUEVO — opcional, solo presente desde el endpoint multi-agente
}
```

**Reglas semánticas**:
- En el endpoint **mono-agente** (`GET /api/recorridos/hoja-de-ruta-por-agente/:id`) el campo `agentesDestino` queda **ausente** (no lo emite el servicio mono). Esto preserva contrato 1:1 con consumidores actuales.
- En el endpoint **multi-agente** (`POST /api/recorridos/hoja-de-ruta-por-agentes`):
  - `agentesDestino` se emite **siempre** (array, posiblemente vacío) en cada parada.
  - `esDestinoBuscado === (agentesDestino.length >= 1)`. La fuente de verdad sigue siendo `agentesDestino` para la UI, pero `esDestinoBuscado` se mantiene para no romper la lógica de coloreo existente en `HojaDeRutaTable`.

### 1.2 Nuevo tipo de respuesta: `MultiAgenteResponse`

Agregar a ambos lados (servicio backend y `types.ts` del frontend):

```ts
export interface MultiAgenteResponse {
  data: HojaDeRuta[];
  agentesNoEncontrados: string[];   // documentIds que no existen o no tienen parada inicial
}
```

El controller envuelve esto como `{ data: { data: HojaDeRuta[], agentesNoEncontrados: string[] } }` siguiendo la convención Strapi (igual que el mono-agente devuelve `{ data: HojaDeRuta[] }` y se accede vía `res.data.data`).

### 1.3 Tipos compartidos backend ↔ frontend

Hoy los tipos están **duplicados** entre `services/recorrido.ts` (locales, no exportados) y `admin/extensions/components/AsignarAgente/types.ts` (exportados). Mantenemos esa duplicación porque:

1. Strapi compila `src/admin/**` y `src/api/**` con tsconfigs distintos (admin es Vite, API es Node).
2. Importar desde `src/api/...` dentro de `src/admin/...` cruza ese límite y rompe el bundle.
3. La duplicación existente ya funciona; agregar un tipo compartido (e.g. `src/shared/types`) es un refactor fuera de scope.

**Decisión**: agregamos `agentesDestino?` en **los dos lugares** y aceptamos la duplicación local. (Anotado como deuda técnica en risks.)

---

## 2. New service method: `resolverHojaDeRutaPorAgentes`

### 2.1 Firma

```ts
async resolverHojaDeRutaPorAgentes(
  ids: string[],
): Promise<{ data: HojaDeRuta[]; agentesNoEncontrados: string[] }>
```

### 2.2 Algoritmo (paso a paso)

```ts
async resolverHojaDeRutaPorAgentes(ids: string[]) {
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

  // ───── 2. Resolución de agentes (validar existencia + obtener AgenteDetalle) ─────
  const agentesEncontrados = await strapi.documents('api::agente.agente').findMany({
    filters: { documentId: { $in: idsUnicos } },
  });
  const agentesPorDocId = new Map<string, AgenteDetalle>(
    agentesEncontrados.map((a: any) => [a.documentId, toAgenteDetalle(a)]),
  );
  const agentesNoEncontrados: string[] = idsUnicos.filter(
    (id) => !agentesPorDocId.has(id),
  );

  // Si ninguno existe, devolver shape vacío (UI muestra empty state con la lista).
  if (agentesPorDocId.size === 0) {
    return { data: [], agentesNoEncontrados };
  }

  // ───── 3. Una sola query $in para todas las paradas iniciales ─────
  const idsExistentes = Array.from(agentesPorDocId.keys());
  const paradasIniciales = await strapi.documents('api::parada.parada').findMany({
    filters: { destino_agente: { documentId: { $in: idsExistentes } } },
    populate: { recorrido: true, destino_agente: true },
  });

  // Agentes que existen pero no tienen parada inicial → también van a noEncontrados.
  const agentesConParada = new Set<string>(
    paradasIniciales.map((p: any) => p.destino_agente?.documentId).filter(Boolean),
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
    const raiz = await this.ascenderHastaRaiz(
      recorridoInicial,
      visitedAscenso,
      warningsLocal,
    );

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
    // Construir Map<agenteDocId, AgenteDetalle> SOLO con los agentes de esta raíz
    // para que expandirRecursivo pueda inyectar el detalle completo en agentesDestino.
    const agentesDeRaiz = new Map<string, AgenteDetalle>();
    for (const id of agenteIdSet) {
      const detalle = agentesPorDocId.get(id);
      if (detalle) agentesDeRaiz.set(id, detalle);
    }

    const hoja = await this.expandirDesdeRaizMulti(
      rootDocId,
      agentesDeRaiz,
      visitedDFS,
      warnings,
    );
    if (hoja) hojas.push(hoja);
  }

  // ───── 6. Orden estable: por recorridoRaiz.codigo ascendente ─────
  hojas.sort((a, b) =>
    a.recorridoRaiz.codigo.localeCompare(b.recorridoRaiz.codigo, undefined, { numeric: true }),
  );

  return { data: hojas, agentesNoEncontrados };
}
```

### 2.3 Reuso de helpers existentes — qué cambia y qué no

| Helper | Cambia? | Razón |
|---|---|---|
| `ascenderHastaRaiz` | NO cambia | Ya es independiente del agente; sube por `destino_recorrido` puro. |
| `expandirDesdeRaiz` | Se duplica como `expandirDesdeRaizMulti` con firma multi-agente. El mono queda intacto. | Mantener mono-agente sin tocarlo (success criteria #5 del proposal). |
| `expandirRecursivo` | Se duplica como `expandirRecursivoMulti` con firma multi-agente. El mono queda intacto. | Idem. |

**Decisión arquitectónica**: en vez de modificar `expandirRecursivo` (que rompería la firma del mono-agente y obligaría a un adaptador), creamos **dos funciones gemelas** `expandirDesdeRaizMulti` y `expandirRecursivoMulti`. Ver rationale en sección 7.

### 2.4 Nuevas funciones gemelas — firmas

```ts
async expandirDesdeRaizMulti(
  recorridoDocumentId: string,
  agentes: Map<string, AgenteDetalle>,   // antes: agenteDocumentId: string
  visited: Set<string>,
  warnings: string[],
): Promise<HojaDeRuta | null>;

async expandirRecursivoMulti(
  recorridoDocumentId: string,
  agentes: Map<string, AgenteDetalle>,
  visited: Set<string>,
  nivel: number,
  acc: ParadaExpandida[],
  warnings: string[],
): Promise<void>;
```

### 2.5 Cómo se popula `agentesDestino` por parada

Dentro de `expandirRecursivoMulti`, el bloque que hoy en mono hace:

```ts
esDestinoBuscado: tieneAgente && parada.destino_agente.documentId === agenteDocumentId,
```

Pasa a hacer:

```ts
const agentesDestino: AgenteDetalle[] = [];
if (tieneAgente) {
  const candidato = agentes.get(parada.destino_agente.documentId);
  if (candidato) agentesDestino.push(candidato);
}
// Nota: con schema oneToOne en parada.destino_agente, agentesDestino tendrá
// como máximo 1 elemento por parada. La estructura es array para soportar
// futuras extensiones (manyToOne / manyToMany) sin cambiar el contrato del tipo.

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
```

Clave: `agentesDestino` recibe el **`AgenteDetalle` completo** (no solo el documentId). Esto es lo que permite renderizar badges con `IdAgente` sin un round-trip extra al backend desde la UI.

### 2.6 Validación de input — resumen de errores

| Caso | Acción | HTTP |
|---|---|---|
| `agentes` no es array | `throw err.status=400` | 400 |
| `agentes` es array vacío | `throw err.status=400` | 400 |
| Algún ID no es string o no matchea `DOCUMENT_ID_REGEX` | `throw err.status=400` | 400 |
| Todos los IDs válidos pero ninguno existe en BD | OK — devuelve `{ data: [], agentesNoEncontrados: [...] }` | 200 |
| Algunos existen, otros no | OK — devuelve `{ data: [...], agentesNoEncontrados: [...] }` | 200 |
| Error inesperado de Strapi | re-throw → middleware Strapi devuelve 500 | 500 |

Deduplicación se hace en el servicio (no en el controller) para mantener el contrato del controller mínimo.

---

## 3. Controller action: `hojaDeRutaPorAgentes`

### 3.1 Firma y body

```ts
async hojaDeRutaPorAgentes(ctx) {
  const body = ctx.request.body ?? {};
  const { agentes } = body;

  // Validación mínima en controller (la profunda vive en el servicio)
  if (!Array.isArray(agentes)) {
    return ctx.badRequest('agentes debe ser un array de documentIds');
  }
  if (agentes.length === 0) {
    return ctx.badRequest('agentes no puede ser vacío');
  }

  try {
    const result = await strapi
      .service('api::recorrido.recorrido')
      .resolverHojaDeRutaPorAgentes(agentes);
    return { data: result };
  } catch (err: any) {
    if (err?.status === 400) return ctx.badRequest(err.message);
    if (err?.status === 404) return ctx.notFound(err.message);
    throw err;  // 500 vía middleware Strapi
  }
}
```

### 3.2 Mapping de errores

| Servicio lanza | Controller responde |
|---|---|
| `err.status === 400` | `ctx.badRequest(err.message)` → 400 |
| `err.status === 404` | `ctx.notFound(err.message)` → 404 (no se usa hoy, reservado) |
| Otro error | re-throw → 500 con shape estándar Strapi |

### 3.3 Response shape

```ts
// HTTP 200 OK
{
  "data": {
    "data": HojaDeRuta[],
    "agentesNoEncontrados": string[]
  }
}
```

El doble `data.data` es la convención Strapi (controller envuelve en `data`, el servicio ya devuelve un objeto con su propio `data`). En el frontend se accede como `res.data.data.data` y `res.data.data.agentesNoEncontrados`. (Ver sección 5 sobre el unwrap en frontend.)

> **Alternativa considerada y rechazada**: devolver directamente `{ data, agentesNoEncontrados }` desde el servicio (sin nest). Rechazada porque el controller `ctx.send({ data, agentesNoEncontrados })` rompe la simetría con el mono-agente que devuelve `{ data: HojaDeRuta[] }`.

---

## 4. Route addition

`src/api/recorrido/routes/01-custom-hoja-de-ruta.ts` queda con **dos rutas**, mono primero (existente), multi después (nueva):

```ts
export default {
  routes: [
    {
      method: 'GET',
      path: '/recorridos/hoja-de-ruta-por-agente/:agenteDocumentId',
      handler: 'recorrido.hojaDeRutaPorAgente',
      config: { auth: false, policies: [] },
    },
    {
      method: 'POST',
      path: '/recorridos/hoja-de-ruta-por-agentes',
      handler: 'recorrido.hojaDeRutaPorAgentes',
      config: { auth: false, policies: [] },
    },
  ],
};
```

`auth: false` mantiene la convención del mono-agente. Si en el futuro se endurece la auth, se hace en un change separado para ambos endpoints a la vez.

---

## 5. Frontend state & data flow

### 5.1 State variables — antes vs después

**Antes** (en `index.tsx`):

```ts
const [agenteSeleccionado, setAgenteSeleccionado] = useState<string>('');
const [hojas, setHojas] = useState<HojaDeRuta[]>([]);
const [error, setError] = useState<string | null>(null);
```

**Después**:

```ts
const [agentesSeleccionados, setAgentesSeleccionados] = useState<string[]>([]);
const [resultado, setResultado] = useState<{
  hojas: HojaDeRuta[];
  agentesNoEncontrados: string[];
} | null>(null);
const [error, setError] = useState<string | null>(null);
```

`resultado` reemplaza a `hojas` y agrega `agentesNoEncontrados`. Es `null` mientras no hay respuesta; un objeto cuando hay (incluso con arrays vacíos). Esto distingue "no se llamó aún" de "se llamó y no hay nada".

### 5.2 `handleConfirmar` — pseudocódigo

```ts
const handleConfirmar = async () => {
  if (agentesSeleccionados.length === 0) return;
  setLoadingHojas(true);
  setError(null);
  try {
    const res = await post<{ data: MultiAgenteResponse }>(
      '/api/recorridos/hoja-de-ruta-por-agentes',
      { agentes: agentesSeleccionados },
    );
    // Strapi wrap: res.data.data === MultiAgenteResponse
    setResultado({
      hojas: res.data.data.data ?? [],
      agentesNoEncontrados: res.data.data.agentesNoEncontrados ?? [],
    });
    setStep('result');
  } catch (err: any) {
    const msg =
      err?.response?.data?.error?.message ??
      err?.message ??
      'Error al generar las hojas de ruta';
    setError(msg);
    setStep('result');
  } finally {
    setLoadingHojas(false);
  }
};
```

`useFetchClient` expone `post` (igual que `get`); se desestructura con `const { get, post } = useFetchClient();`.

### 5.3 Reset state actualizado

```ts
const resetState = () => {
  setStep('select');
  setAgentesSeleccionados([]);
  setResultado(null);
  setError(null);
};
```

---

## 6. Component changes

### 6.1 `index.tsx` — imports

**Quitar**: `Combobox`, `ComboboxOption`.
**Agregar**: `MultiSelect`, `MultiSelectOption`, `Accordion`.

```ts
import {
  Button,
  Box,
  Modal,
  MultiSelect,
  MultiSelectOption,
  Accordion,
  Loader,
  Flex,
  Field,
  Typography,
  Badge,
} from '@strapi/design-system';
```

### 6.2 `index.tsx` — render del paso `select`

```tsx
<Field.Root>
  <Field.Label>Agentes</Field.Label>
  <MultiSelect
    placeholder="Seleccioná uno o más agentes..."
    value={agentesSeleccionados}
    onChange={(values: string[]) => setAgentesSeleccionados(values ?? [])}
    withTags
  >
    {agentes.map((agente) => (
      <MultiSelectOption key={agente.documentId} value={agente.documentId}>
        {agente.IdAgente} — {agente.RazonSocial}
      </MultiSelectOption>
    ))}
  </MultiSelect>
</Field.Root>
```

Botón "Confirmar" se habilita con `agentesSeleccionados.length > 0` en vez de `!!agenteSeleccionado`.

### 6.3 `index.tsx` — render del paso `result` con `Accordion`

```tsx
{resultado.agentesNoEncontrados.length > 0 && (
  <Box paddingBottom={4} background="warning100" padding={3} hasRadius>
    <Typography variant="omega" textColor="warning700" fontWeight="bold">
      Agentes no encontrados ({resultado.agentesNoEncontrados.length}):
    </Typography>
    <Box paddingTop={2}>
      <Flex gap={2} wrap="wrap">
        {resultado.agentesNoEncontrados.map((id) => {
          const agente = agentes.find((a) => a.documentId === id);
          return (
            <Badge key={id} backgroundColor="warning200" textColor="warning700">
              {agente ? agente.IdAgente : id}
            </Badge>
          );
        })}
      </Flex>
    </Box>
  </Box>
)}

{resultado.hojas.length === 0 ? (
  <Box padding={4}>
    <Typography textColor="neutral700">
      Ninguno de los agentes seleccionados aparece en un recorrido.
    </Typography>
  </Box>
) : (
  <Accordion.Root size="M" type="multiple">
    {resultado.hojas.map((hoja) => (
      <Accordion.Item key={hoja.recorridoRaiz.documentId} value={hoja.recorridoRaiz.documentId}>
        <Accordion.Header>
          <Accordion.Trigger>
            {hoja.recorridoRaiz.codigo} — {hoja.recorridoRaiz.descripcion}
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          <Box padding={4}>
            <HojaDeRutaTable hoja={hoja} />
          </Box>
        </Accordion.Content>
      </Accordion.Item>
    ))}
  </Accordion.Root>
)}
```

`type="multiple"` permite múltiples paneles abiertos a la vez (success criteria #3).

### 6.4 `HojaDeRutaTable.tsx` — renderizado de `agentesDestino`

**Decisión**: en vez de agregar una **columna nueva** (`Agentes destino`), renderizar los badges **inline en la celda `Detalle`**, debajo del texto del agente, **solo cuando `agentesDestino` está presente y tiene ≥1 elemento**.

**Rationale**:
- Una columna nueva inflaría el ancho de la tabla y quedaría vacía para todas las filas que no son destino (la mayoría).
- Inline es más cercano visualmente a la información que enriquece (qué agente termina en esta parada).
- Mantiene la tabla con la misma `colCount` (5) y el mismo header — cero cambios de layout.

```tsx
<Td>
  <Typography
    textColor={parada.esDestinoBuscado ? 'primary700' : 'neutral800'}
    fontWeight={parada.esDestinoBuscado ? 'bold' : undefined}
  >
    {formatDetalle(parada)}
  </Typography>
  {parada.agentesDestino && parada.agentesDestino.length > 0 && (
    <Box paddingTop={1}>
      <Flex gap={1} wrap="wrap">
        {parada.agentesDestino.map((a) => (
          <Badge key={a.documentId} backgroundColor="primary100" textColor="primary700">
            {a.IdAgente}
          </Badge>
        ))}
      </Flex>
    </Box>
  )}
</Td>
```

`Flex` se importa al archivo. El badge muestra **solo `IdAgente`** (decisión Q3 cerrada) con estilo consistente con el resto del admin (`primary100/primary700`, sin paleta determinística por agente).

La lógica existente de coloreo de filas (`background={parada.esDestinoBuscado ? 'primary100' : undefined}`) **NO cambia** porque `esDestinoBuscado` sigue siendo boolean derivado de `agentesDestino.length >= 1` en el backend.

### 6.5 `types.ts` — único cambio aditivo

```diff
 export interface ParadaExpandida {
   ordenVisita: number;
   nombre: string;
   recorridoOrigen: RecorridoRef;
   tipo: TipoParada;
   detalle: DetalleParada;
   nivel: number;
   esDestinoBuscado: boolean;
+  agentesDestino?: AgenteDetalle[];
 }

+export interface MultiAgenteResponse {
+  data: HojaDeRuta[];
+  agentesNoEncontrados: string[];
+}
```

`HojaDeRutaResponse` (mono) **no se toca**.

---

## 7. Architecture decisions with rationale (ADR-style)

### ADR-1 — Funciones gemelas `*Multi` en vez de modificar `expandirRecursivo`

**Decisión**: crear `expandirDesdeRaizMulti` y `expandirRecursivoMulti` en paralelo a las existentes, en vez de modificar la firma de `expandirRecursivo` para aceptar `Map<string, AgenteDetalle>` y adaptar el mono-agente a llamarla con un Map de un solo elemento.

**Rationale**:
- El proposal exige (success criteria #5) que el endpoint mono-agente "mantiene exactamente el mismo contrato (response shape, status codes)". Modificar el helper que usa internamente, aunque no rompa el contrato HTTP, agrega riesgo de regresión por cambio de firma.
- La duplicación es **acotada y simétrica**: ~30 líneas de código, mismo control de flujo, solo cambia cómo se calcula `esDestinoBuscado`/`agentesDestino`.
- Si en el futuro se decide unificar, se hace en un refactor explícito (con tests cubriendo ambos caminos primero).

**Rechazado**: Adaptador `expandirRecursivo(rec, agenteId, ...)` que internamente llama a `expandirRecursivoMulti(rec, new Map([[agenteId, ...]]), ...)`. Implica `findOne` extra para obtener el `AgenteDetalle` completo del agente único — el mono hoy NO lo necesita porque solo usa `documentId` para comparar. Rompería perf del mono sin razón.

### ADR-2 — `agentesDestino: AgenteDetalle[]` (no `string[]` ni `documentId[]`)

**Decisión**: el campo es array de objetos `AgenteDetalle` completos.

**Rationale**:
- La UI necesita mostrar `IdAgente` (no `documentId`) en los badges. Si el backend devolviera solo IDs, el frontend tendría que hacer un lookup por agente en cada parada, o cargar previamente todos los agentes.
- Como ya cargamos los `AgenteDetalle` en el paso 2 del algoritmo (para detectar `agentesNoEncontrados`), inyectarlos en `agentesDestino` es prácticamente gratis.
- Cumple la regla de **api-design-principles**: "minimize data serialized across the boundary" se respeta porque solo se serializan los agentes que efectivamente están en cada parada (no toda la lista).

**Rechazado**:
- `agentesDestino: string[]` (solo documentIds) — fuerza al frontend a hacer un Map<documentId, AgenteDetalle> y un lookup por parada. Acopla la UI a tener la lista completa cargada.
- `agentesDestino: { documentId, IdAgente }[]` (subset minimal) — ahorra ~40 bytes por agente, pero rompe la simetría con `parada.detalle` que ya usa `AgenteDetalle` completo.

### ADR-3 — `esDestinoBuscado` se mantiene como boolean (back-compat)

**Decisión**: no quitar ni renombrar `esDestinoBuscado`, aunque `agentesDestino.length >= 1` da la misma info.

**Rationale**:
- `HojaDeRutaTable.tsx` ya usa `esDestinoBuscado` en **5 lugares** distintos (background de fila, color del badge de tipo, color del texto, fontWeight del texto, color condicional). Cambiarlo por `parada.agentesDestino?.length` introduce branching `?.` en cada uso y aumenta la superficie del cambio.
- Es una **invariante derivable**: el backend la calcula una vez, la UI la consume sin cambios.
- Cumple regla **interface-design**: "consistent with existing component hierarchy" — la tabla sigue funcionando sin modificar su lógica de coloreo.

### ADR-4 — Sort estable por `recorridoRaiz.codigo` con `localeCompare numeric`

**Decisión**: ordenar `hojas` ascendente por `codigo` usando `localeCompare(..., { numeric: true })`.

**Rationale**:
- Q2 del proposal cerrada: orden alfabético por raíz (no por orden de selección, que sería confuso si hay raíces compartidas entre múltiples agentes).
- `numeric: true` para que `R10` venga después de `R2` (orden natural humano), no antes (orden lexicográfico puro).
- Determinístico → la UI no parpadea entre llamadas con los mismos inputs.

### ADR-5 — Validación dividida controller/servicio

**Decisión**: el controller hace validación **estructural** (es array, no vacío); el servicio hace validación **profunda** (cada elemento es string que matchea regex, dedup).

**Rationale**:
- El controller filtra request malformados sin tocar la BD (cheap fail).
- El servicio centraliza la lógica de negocio (regex, dedup) que debe correr aunque el controller cambie en el futuro.
- Cumple **error-handling-patterns**: "use custom exception hierarchy; never swallow errors silently" — se usa el patrón existente de `err.status` que el mono-agente ya tiene.

### ADR-6 — Inline badges en celda `Detalle` (no nueva columna)

**Decisión**: ya documentada en sección 6.4. Resumen: el badge va dentro de la celda existente `Detalle`, debajo del texto.

**Rationale**: ya cubierto. Cumple **interface-design**: "subtle surface layering: consistent with existing component hierarchy".

### ADR-7 — `agentesNoEncontrados` agrupa dos casos distintos

**Decisión**: el array `agentesNoEncontrados` incluye tanto **agentes que no existen en BD** como **agentes que existen pero no tienen parada inicial**.

**Rationale**:
- Desde la perspectiva del usuario, ambos casos significan "no puedo mostrarte hoja de ruta para este agente". Distinguirlos en la UI ("no existe" vs "existe sin paradas") agrega ruido sin valor operativo.
- Si en el futuro se necesita distinguir, se puede agregar `agentesSinParadas: string[]` como campo adicional sin romper contrato.

---

## 8. Risks & assumptions to validate

| ID | Riesgo | Mitigación |
|----|--------|------------|
| D1 | Tipos duplicados backend/frontend pueden divergir si alguien edita uno y olvida el otro | Tarea explícita en `tasks` para editar ambos en el mismo commit. Comentario `// MIRROR: src/admin/extensions/components/AsignarAgente/types.ts` en el archivo del backend |
| D2 | `MultiSelect` viene de `@strapi/design-system` como dependencia transitiva (R2 del proposal) | Verificar import en build de admin antes de mergear; si falla, agregar como dep directa en un PR aparte (fuera de scope este change) |
| D3 | Si un agente está en MUY muchos recorridos (`paradas.findMany` con `$in` muy grande) puede saturar memoria | Asumimos N pequeño (≤10 agentes) según proposal; sin tope explícito (R1 del proposal) |
| D4 | `localeCompare` con `numeric: true` puede ordenar diferente en entornos con locales no-default | Pasar locale explícito si se observa inconsistencia. Por ahora, default browser/node es suficiente |
| D5 | El `useFetchClient` de Strapi puede no soportar `post` con la misma firma que `get` en versiones viejas | Verificar en QA con versión actual de Strapi instalada (5.x según `package.json`) |

---

## 9. Out of scope (recordatorio)

Estas cosas **no se diseñan acá** y se mencionan solo para evitar confusión:

- Cap máximo de agentes por request (sin tope, anotado como riesgo en proposal).
- Persistencia de selección entre sesiones del modal (se resetea al cerrar).
- Bulk-assign desde la UI (solo visualización).
- Color por agente / paleta determinística (Q3 cerrada: solo `IdAgente` text con estilo neutro).
- Convertir `@strapi/design-system` a dep directa.
- Refactor para tipos compartidos backend/frontend.

---

**Next phase**: `sdd-tasks` (después de que spec esté listo). Las tasks descompondrán este diseño en pasos ejecutables con checkboxes.
