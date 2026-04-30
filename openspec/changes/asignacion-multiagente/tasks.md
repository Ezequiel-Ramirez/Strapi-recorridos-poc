# Tasks: Asignación Multi-Agente

**Change**: `asignacion-multiagente`
**Project**: `strapi-recorridos-poc`
**Spec requirements covered**: S1, S2, S3, S4, S5, S6, S7, NFR-1, NFR-2

---

## Phase 1: Types — Foundation (parallel-safe)

- [x] 1.1 `src/api/recorrido/services/recorrido.ts` — add `agentesDestino?: AgenteDetalle[]` to the local `ParadaExpandida` interface. Add comment `// MIRROR: src/admin/extensions/components/AsignarAgente/types.ts` on the same line or directly above. _(Spec: agentesDestino Field Contract)_
- [x] 1.2 `src/admin/extensions/components/AsignarAgente/types.ts` — add `agentesDestino?: AgenteDetalle[]` to `ParadaExpandida` export. Add `export interface MultiAgenteResponse { data: HojaDeRuta[]; agentesNoEncontrados: string[]; }`. _(Spec: agentesDestino Field Contract, Frontend Accordion)_

✅ **COMPLETED** — Phase 1 complete (2/2 tasks)

> Tasks 1.1 and 1.2 are independent and can be done in any order or simultaneously.

---

## Phase 2: Backend Service (sequential within phase)

- [x] 2.1 `src/api/recorrido/services/recorrido.ts` — add `expandirRecursivoMulti(recorridoDocumentId, agentes: Map<string, AgenteDetalle>, visited, nivel, acc, warnings): Promise<void>`. Mirror structure of existing `expandirRecursivo`; replace the mono `esDestinoBuscado` check with the `agentesDestino` array population logic from design §2.5. _(Spec: agentesDestino Field Contract, esDestinoBuscado Field, NFR-1)_
- [x] 2.2 `src/api/recorrido/services/recorrido.ts` — add `expandirDesdeRaizMulti(recorridoDocumentId, agentes: Map<string, AgenteDetalle>, visited, warnings): Promise<HojaDeRuta | null>`. Mirror structure of `expandirDesdeRaiz`; call `expandirRecursivoMulti` internally. _(Spec: NFR-1, Service Deduplication by Root)_
- [x] 2.3 `src/api/recorrido/services/recorrido.ts` — add `resolverHojaDeRutaPorAgentes(ids: string[]): Promise<{ data: HojaDeRuta[]; agentesNoEncontrados: string[] }>`. Implement the 6-step algorithm from design §2.2: validate input, deduplicate, resolve agents via `$in`, find initial paradas, ascend to root building `Map<rootDocId, Set<agenteDocId>>`, DFS once per unique root, sort by `recorridoRaiz.codigo` with `localeCompare(undefined, { numeric: true })`. _(Spec: S1, S2, S3, S4, S5, Service Deduplication, agentesNoEncontrados, Response Order, NFR-1)_

✅ **COMPLETED** — Phase 2 complete (3/3 tasks)

> 2.1 must complete before 2.2. 2.2 must complete before 2.3. Do NOT modify `expandirRecursivo`, `expandirDesdeRaiz`, or `resolverHojaDeRutaPorAgente` (NFR-2).

---

## Phase 3: Backend Route + Controller (sequential; requires Phase 2)

- [x] 3.1 `src/api/recorrido/routes/01-custom-hoja-de-ruta.ts` — append POST route entry: `{ method: 'POST', path: '/recorridos/hoja-de-ruta-por-agentes', handler: 'recorrido.hojaDeRutaPorAgentes', config: { auth: false, policies: [] } }` inside the existing `routes` array, after the GET route. _(Spec: POST Input Validation)_
- [x] 3.2 `src/api/recorrido/controllers/recorrido.ts` — add `hojaDeRutaPorAgentes(ctx)` action. Validate `agentes` is a non-empty array; call `resolverHojaDeRutaPorAgentes(agentes)`; return `{ data: result }`. Map `err.status === 400` to `ctx.badRequest`, `err.status === 404` to `ctx.notFound`, re-throw otherwise. _(Spec: S5, POST Input Validation, agentesNoEncontrados Behavior)_

✅ **COMPLETED** — Phase 3 complete (2/2 tasks)

> 3.1 and 3.2 can be done in parallel with each other, but both require Phase 2 to be complete.

---

## Phase 4: Frontend index.tsx (requires Phase 1 types)

- [x] 4.1 `src/admin/extensions/components/AsignarAgente/index.tsx` — update imports: remove `Combobox`, `ComboboxOption`; add `MultiSelect`, `MultiSelectOption`, `Accordion` from `@strapi/design-system`. Add `post` to `useFetchClient` destructure: `const { get, post } = useFetchClient()`. Import `MultiAgenteResponse` from `./types`. _(Spec: Frontend MultiSelect)_
- [x] 4.2 `src/admin/extensions/components/AsignarAgente/index.tsx` — replace state: remove `agenteSeleccionado`/`setAgenteSeleccionado` and `hojas`/`setHojas`; add `agentesSeleccionados: string[]` (init `[]`) and `resultado: { hojas: HojaDeRuta[]; agentesNoEncontrados: string[] } | null` (init `null`). Update `resetState` to clear both new state vars. _(Spec: Frontend MultiSelect)_
- [x] 4.3 `src/admin/extensions/components/AsignarAgente/index.tsx` — replace `handleConfirmar`: guard on `agentesSeleccionados.length === 0`; call `post<{ data: MultiAgenteResponse }>('/api/recorridos/hoja-de-ruta-por-agentes', { agentes: agentesSeleccionados })`; set `resultado` from `res.data.data`; transition to `'result'` step in both success and catch. _(Spec: S6, Frontend MultiSelect)_
- [x] 4.4 `src/admin/extensions/components/AsignarAgente/index.tsx` — replace `renderSelectStep`: swap `Combobox`+`ComboboxOption` for `MultiSelect`+`MultiSelectOption` with `withTags` prop; update disabled condition for "Generar hojas de ruta" button to `agentesSeleccionados.length === 0`. _(Spec: S6, Frontend MultiSelect — Minimum Selection Guard)_
- [x] 4.5 `src/admin/extensions/components/AsignarAgente/index.tsx` — replace `renderResultStep`: render `agentesNoEncontrados` warning banner (Box with `background="warning100"`, non-dismissible) ABOVE the accordion when `resultado.agentesNoEncontrados.length > 0`; render `Accordion.Root type="multiple"` with one `Accordion.Item` per hoja (key and value = `recorridoRaiz.documentId`, trigger text = `codigo — descripcion`); render empty state Typography when `resultado.hojas.length === 0`. Update Modal.Title in result step to say "Hojas de Ruta Generadas". _(Spec: Frontend Accordion — Multi-expand, Frontend agentesNoEncontrados Feedback)_

✅ **COMPLETED** — Phase 4 complete (5/5 tasks)

> Tasks 4.1 → 4.2 → 4.3 are sequential (each builds on the prior). Tasks 4.4 and 4.5 depend on 4.2 but can proceed in parallel with each other.

---

## Phase 5: Frontend HojaDeRutaTable.tsx (requires Phase 1 types)

- [x] 5.1 `src/admin/extensions/components/AsignarAgente/HojaDeRutaTable.tsx` — verify `Flex` is imported from `@strapi/design-system`; add it if missing. In the `Detalle` `<Td>`, after the existing `<Typography>` block, add the conditional badge block: `{parada.agentesDestino && parada.agentesDestino.length > 0 && (<Box paddingTop={1}><Flex gap={1} wrap="wrap">{parada.agentesDestino.map((a) => (<Badge key={a.documentId} backgroundColor="primary100" textColor="primary700">{a.IdAgente}</Badge>))}</Flex></Box>)}`. Do NOT change `colCount`, table headers, or the `esDestinoBuscado` row-coloring logic. _(Spec: Frontend Badge Rendering, No-Regression Mono-Agent)_

✅ **COMPLETED** — Phase 5 complete (1/1 tasks)

---

## Summary: All Tasks Complete ✅

All 11 tasks across 5 phases have been checked off:
- Phase 1 (Types): 2/2 ✅
- Phase 2 (Backend Service): 3/3 ✅
- Phase 3 (Route + Controller): 2/2 ✅
- Phase 4 (Frontend index.tsx): 5/5 ✅
- Phase 5 (Frontend HojaDeRutaTable.tsx): 1/1 ✅

**Total**: 13/13 implementation tasks completed.

---

## Implementation Order Summary

```
Phase 1 (types) ──┬──► Phase 2 (service) ──► Phase 3 (route+controller)
                  │
                  └──► Phase 4 (frontend index.tsx)
                  └──► Phase 5 (HojaDeRutaTable)
```

Phases 4 and 5 are independent of Phases 2 and 3 (frontend doesn't import backend). Start Phase 1 first; once types are done, Phases 2, 4, and 5 can proceed in parallel. Phase 3 must wait for Phase 2.

**Total tasks**: 11
**Parallel opportunities**: 1.1//1.2, then 2.x//4.x//5.x (after Phase 1), then 3.1//3.2 (after Phase 2)
