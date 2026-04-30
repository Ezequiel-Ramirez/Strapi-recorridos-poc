# Spec — Asignación Multi-Agente

**Change**: `asignacion-multiagente`
**Project**: `strapi-recorridos-poc`
**Phase**: spec
**Status**: archived

---

## Requirements

### Requirement: POST /api/recorridos/hoja-de-ruta-por-agentes — Input Validation

The endpoint MUST accept `{ agentes: string[] }` in the request body.
The endpoint MUST return `400 Bad Request` if `agentes` is missing, not an array, or an empty array.
The endpoint MUST deduplicate `documentId` values before processing (duplicate entries in `agentes` MUST be treated as a single agent).
Invalid non-string entries in `agentes` MUST be rejected with `400 Bad Request`.

#### Scenario: S5 — Empty agentes array

- GIVEN a POST request to `/api/recorridos/hoja-de-ruta-por-agentes`
- WHEN the body is `{ "agentes": [] }`
- THEN the response status is `400 Bad Request`
- AND the response body follows the standard error shape `{ error, message, details, timestamp, path }`

#### Scenario: Missing agentes field

- GIVEN a POST request to `/api/recorridos/hoja-de-ruta-por-agentes`
- WHEN the body does not contain the `agentes` field
- THEN the response status is `400 Bad Request`

#### Scenario: Duplicate documentIds in agentes

- GIVEN a POST request with `{ "agentes": ["id-A", "id-A", "id-B"] }`
- WHEN the controller processes the body
- THEN duplicates are removed before forwarding to the service
- AND the service receives `["id-A", "id-B"]`

---

### Requirement: Service Deduplication by Root

The service `resolverHojaDeRutaPorAgentes` MUST group agents that share the same `recorridoRaiz` into a single `HojaDeRuta`, not one per agent.
The algorithm MUST be O(M unique roots): one `$in` query for all initial stops, ascent to root building a `Map<rootDocId, Set<agenteDocId>>`, then one DFS expansion per unique root.
The number of DFS expansions MUST equal the number of unique roots, not the number of input agents.

#### Scenario: S1 — 2 agents in the same root

- GIVEN 2 agents with `documentId` `id-A` and `id-B`, both having their initial stop in the same `recorridoRaiz`
- WHEN POST `/api/recorridos/hoja-de-ruta-por-agentes` is called with `{ "agentes": ["id-A", "id-B"] }`
- THEN the response `data` contains exactly 1 `HojaDeRuta`
- AND that `HojaDeRuta` has 2 badge entries across its paradas (one per agent at their respective destination stop)
- AND 1 DFS expansion was performed (not 2)

#### Scenario: S2 — 2 agents in different roots

- GIVEN 2 agents `id-A` and `id-B`, each having their initial stop in a different `recorridoRaiz`
- WHEN POST `/api/recorridos/hoja-de-ruta-por-agentes` is called with `{ "agentes": ["id-A", "id-B"] }`
- THEN the response `data` contains exactly 2 `HojaDeRuta` items
- AND 2 DFS expansions were performed

---

### Requirement: agentesNoEncontrados Behavior

The response MUST always include `agentesNoEncontrados: string[]` listing `documentId` values that were in the input but not found in the database or have no initial stop.
If some (but not all) agents are not found, the response MUST still return `data` with the results for found agents.
If ALL agents are not found, the response MUST return `{ data: [], agentesNoEncontrados: string[] }` with the complete list of unfound `documentId` values.
The HTTP status MUST be `200 OK` in both partial and all-not-found cases (it is informational, not an error).

#### Scenario: S3 — 3 agents, 1 not found

- GIVEN 3 agents `id-A`, `id-B`, `id-C`, where `id-C` does not exist in the database
- WHEN POST `/api/recorridos/hoja-de-ruta-por-agentes` is called
- THEN the response status is `200 OK`
- AND `data` contains results for `id-A` and `id-B`
- AND `agentesNoEncontrados` is `["id-C"]`

#### Scenario: S4 — All agents not found

- GIVEN a POST request with `{ "agentes": ["id-X", "id-Y"] }` where neither agent exists
- WHEN the service processes the request
- THEN the response status is `200 OK`
- AND `data` is `[]`
- AND `agentesNoEncontrados` is `["id-X", "id-Y"]`

---

### Requirement: agentesDestino Field Contract

The field `agentesDestino: AgenteDetalle[]` MUST be present only in the multi-agent endpoint response.
Each `ParadaExpandida` in a multi-agent `HojaDeRuta` MUST include `agentesDestino: AgenteDetalle[]` when at least one searched agent terminates at that parada.
`agentesDestino` MUST be absent or not present in the mono-agent endpoint response (the existing GET endpoint MUST NOT return this field).
`AgenteDetalle` MUST include at minimum the `IdAgente` field (unique identifier for display in badges).

#### Scenario: agentesDestino populated at matching parada

- GIVEN a multi-agent request where agent `id-A` terminates at `parada-7`
- WHEN the service builds the `HojaDeRuta`
- THEN `parada-7.agentesDestino` contains exactly one entry with the `IdAgente` of agent `id-A`
- AND other paradas without a matching agent MUST have `agentesDestino` as `[]` or absent

---

### Requirement: esDestinoBuscado Field

Each `ParadaExpandida` MUST include `esDestinoBuscado: boolean`.
`esDestinoBuscado` MUST be `true` if and only if `agentesDestino.length >= 1` for that parada.
This field MUST be consistent with `agentesDestino` — they MUST NOT contradict each other.

#### Scenario: esDestinoBuscado consistent with agentesDestino

- GIVEN a parada where 2 searched agents terminate
- WHEN the `HojaDeRuta` is built
- THEN `esDestinoBuscado` is `true` AND `agentesDestino.length` is `2`

---

### Requirement: Response Order

The `HojaDeRuta[]` array in the response MUST be ordered by `recorridoRaiz.codigo` ascending (lexicographic).
This order MUST be deterministic and consistent across repeated identical requests.

---

### Requirement: No-Regression — Mono-Agent Endpoint

The existing endpoint `GET /api/recorridos/hoja-de-ruta-por-agente/:id` MUST return exactly the same response shape as before this change.
The existing service method `resolverHojaDeRutaPorAgente` MUST NOT be modified.
`agentesDestino` MUST NOT appear in the mono-agent response.

#### Scenario: S7 — Mono-agent endpoint unchanged

- GIVEN a GET request to `/api/recorridos/hoja-de-ruta-por-agente/:id` after the multi-agent change is deployed
- WHEN the response is received
- THEN the response shape is identical to pre-change behavior
- AND no `agentesDestino` field is present at any level

---

### Requirement: Frontend MultiSelect — Minimum Selection Guard

The `MultiSelect` component MUST NOT enable the "Generar hojas de ruta" button if `agentesSeleccionados.length === 0`.
The button MUST become enabled as soon as at least 1 agent is selected.

#### Scenario: S6 — Single agent selected (minimum valid case)

- GIVEN the user opens the `AsignarAgente` modal
- WHEN the user selects exactly 1 agent via the `MultiSelect`
- THEN the "Generar hojas de ruta" button becomes enabled
- AND clicking it calls `POST /api/recorridos/hoja-de-ruta-por-agentes` with `{ "agentes": ["id-single"] }`
- AND the response includes `agentesDestino` with 1 element (no change to this new endpoint's contract for single agent)

---

### Requirement: Frontend Accordion — Multi-expand

The results MUST be rendered using `Accordion.Root type="multiple"` so that multiple items can be open simultaneously.
Each accordion item title MUST display `recorridoRaiz.codigo` and `recorridoRaiz.descripcion`.

#### Scenario: Multiple accordion items open simultaneously

- GIVEN 2 `HojaDeRuta` items are rendered in the accordion
- WHEN the user expands item 1 and then item 2
- THEN both items remain open simultaneously (neither collapses automatically)

---

### Requirement: Frontend Badge Rendering

`HojaDeRutaTable` MUST render badges per parada when `agentesDestino` exists and `agentesDestino.length > 0`.
Each badge MUST display the `IdAgente` value only (no per-agent color coding; consistent with admin panel styling).
When `agentesDestino` is absent or empty, the cell MUST render as it did before this change.

#### Scenario: Badges shown at destination parada

- GIVEN a parada with `agentesDestino: [{ IdAgente: "AGT-001" }, { IdAgente: "AGT-002" }]`
- WHEN `HojaDeRutaTable` renders
- THEN 2 badges appear in that parada's row, showing `"AGT-001"` and `"AGT-002"`
- AND no badge is shown in paradas with empty `agentesDestino`

---

### Requirement: Frontend agentesNoEncontrados Feedback

When `agentesNoEncontrados.length > 0`, the UI MUST display an informational/warning banner ABOVE the list of hojas de ruta.
The banner MUST list the `IdAgente` (or `documentId`) values of the unfound agents.
The banner MUST NOT be dismissible (informational, persistent during the session view).
The banner MUST NOT block the display of found results.
When ALL agents are not found (`data` is empty), the UI MUST display an empty state with the list of unfound `IdAgente` values instead of the banner-over-results pattern.

#### Scenario: Partial not-found — banner over results

- GIVEN a response with `data: [hojaDeRuta1]` and `agentesNoEncontrados: ["id-C"]`
- WHEN the component renders
- THEN an info/warning banner appears above `hojaDeRuta1`'s accordion
- AND the banner shows `id-C` as unfound
- AND the accordion with `hojaDeRuta1` is still visible and usable

#### Scenario: All not-found — empty state

- GIVEN a response with `data: []` and `agentesNoEncontrados: ["id-X", "id-Y"]`
- WHEN the component renders
- THEN an empty state UI is shown (not a toast, not a dismissible modal)
- AND the empty state lists `"id-X"` and `"id-Y"` as unfound agents

---

## Non-Functional Requirements

### NFR-1: Algorithm Complexity

The service MUST NOT execute N independent DFS expansions for N input agents.
The number of DFS calls MUST equal M (number of unique roots discovered), where M ≤ N.
This MUST be verifiable by a test: for 5 agents sharing 2 roots, the expansion function is called exactly 2 times.

### NFR-2: Existing Endpoint Integrity

The mono-agent endpoint service method MUST remain unmodified at the source level.
No changes to `resolverHojaDeRutaPorAgente`, its route, or its controller action are permitted in this change.
