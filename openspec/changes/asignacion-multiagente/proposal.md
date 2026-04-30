# Proposal — Asignación Multi-Agente en Modal AsignarAgente

**Change**: `asignacion-multiagente`
**Project**: `strapi-recorridos-poc`
**Phase**: proposal
**Status**: archived

## 1. Intent

### Problem
El modal actual `AsignarAgente` permite seleccionar **un único agente** por vez para resolver su hoja de ruta. En la operación real, los supervisores trabajan en lotes: necesitan asignar/visualizar las hojas de ruta de **varios agentes simultáneamente** y, cuando esos agentes comparten una misma ruta raíz (por ejemplo, dos agentes que están en distintas paradas del mismo recorrido), la herramienta debe mostrar **una sola hoja de ruta consolidada** marcando en qué parada está cada agente — no N hojas duplicadas.

### Why now
- Usuarios reportan flujo lento: abrir el modal, seleccionar agente 1, ver, cerrar, abrir de nuevo, seleccionar agente 2…
- No hay forma actual de comparar visualmente rutas compartidas entre agentes.
- La estructura de datos del backend (paradas con `destino_agente` `oneToOne`) se presta naturalmente a deduplicación por raíz, pero el frontend hoy no la aprovecha.

### Success looks like
- Un supervisor abre el modal **una vez**, selecciona N agentes, ve N (o menos, si hay rutas compartidas) hojas de ruta colapsables en el mismo modal.
- Cada parada de destino muestra **chips/badges** con los agentes que terminan ahí (no solo un flag booleano).
- El endpoint y servicio mono-agente existente (`GET /api/recorridos/hoja-de-ruta-por-agente/:id` + `resolverHojaDeRutaPorAgente`) **siguen funcionando sin cambios de contrato**.
- Tiempo de respuesta del nuevo endpoint multi-agente es comparable al mono-agente para casos típicos (≤10 agentes), gracias al algoritmo O(M raíces únicas) en vez de O(N agentes).

## 2. Scope

### In-scope

**Backend**
- Nuevo endpoint `POST /api/recorridos/hoja-de-ruta-por-agentes` que acepta `{ agentes: string[] }` (array de `documentId` de agentes) y devuelve `{ data: HojaDeRuta[], agentesNoEncontrados: string[] }`.
- Nuevo método de servicio `resolverHojaDeRutaPorAgentes(ids: string[])` con algoritmo O(M raíces únicas), no O(N agentes):
  1. Una sola query con `$in` para encontrar todas las paradas iniciales de los N agentes.
  2. Ascenso a raíz construyendo `Map<rootDocId, Set<agenteDocId>>`.
  3. Una sola expansión DFS por cada raíz única, marcando todos los agentes del Set correspondiente en sus paradas de destino.
- Extensión **backward compatible** del tipo `ParadaExpandida`: campo opcional `agentesDestino?: AgenteDetalle[]`. El endpoint mono-agente sigue devolviendo la forma original (sin `agentesDestino` o con array de un solo elemento — definir en spec).
- Nuevo controller action `hojaDeRutaPorAgentes(ctx)` que valida el body y llama al servicio.

**Frontend (admin extension)**
- Reemplazo de `Combobox` por `MultiSelect` (con `withTags`) de `@strapi/design-system 2.2.0` en `src/admin/extensions/components/AsignarAgente/index.tsx`.
- Cambio de estado: `agenteSeleccionado: string` → `agentesSeleccionados: string[]`.
- Una sola llamada `fetch` al nuevo endpoint POST en lugar de N llamadas al endpoint mono.
- Renderizado de resultados: cada `HojaDeRuta` envuelta en `Accordion.Root type="multiple"` (varias expandibles a la vez).
- `HojaDeRutaTable.tsx` muestra **badges** con los agentes presentes en cada parada usando el nuevo campo `agentesDestino`.
- Manejo del array `agentesNoEncontrados` con feedback visible al usuario (warning/info banner).

### Out-of-scope (explícito)
- Paginación o virtualización de la lista de agentes seleccionados (asumimos N pequeño en uso real).
- Políticas de tope máximo de agentes por request (no se impone `max-cap` en este change; se anota como riesgo).
- Convertir `@strapi/design-system` de dependencia transitiva a dependencia directa en `package.json` — es un riesgo de producción real pero **no parte de este change**; se trata como cleanup separado.
- Cambios al endpoint/servicio mono-agente existente. Permanece intacto por contrato.
- Bulk-assign (asignar agentes a paradas desde la UI). Esto es solo **visualización** consolidada.
- Persistencia de la selección de agentes (no se guarda en sesión / localStorage).

## 3. Approach (high-level)

> Las decisiones técnicas ya están cerradas en la fase de exploración (ver `sdd/asignacion-multiagente/explore`). Este proposal **no re-explora alternativas**; solo encuadra la estrategia.

### Backend
1. **Endpoint aditivo** (no breaking): se agrega un POST nuevo. El GET mono-agente queda como está.
2. **Algoritmo O(M raíces únicas)**: una query `$in` para obtener todas las paradas iniciales, ascenso a raíz construyendo `Map<rootDocId, Set<agenteDocId>>`, y luego **una sola expansión DFS por raíz única**. Esto evita el N×DFS naïve cuando varios agentes comparten ruta.
3. **Tipo extendido backward-compatible**: `ParadaExpandida.agentesDestino?: AgenteDetalle[]` es opcional, así el endpoint mono-agente puede seguir devolviendo la forma anterior sin romper consumidores.

### Frontend
1. **Migración de control**: `Combobox` → `MultiSelect withTags` (mismo design system, ya disponible en v2.2.0).
2. **Estado plural**: `agentesSeleccionados: string[]` con guard de "al menos 1 seleccionado" antes de habilitar el botón "Generar hojas de ruta".
3. **Una sola llamada**: el frontend pasa de N fetches a 1 fetch al POST multi-agente.
4. **Accordion multi-expand**: `Accordion.Root type="multiple"` permite que el supervisor abra varias hojas de ruta a la vez para comparar.
5. **Badges por parada**: en `HojaDeRutaTable`, cuando `agentesDestino` existe y tiene ≥1 elemento, se renderiza una columna/fila con chips por agente. Cuando `agentesDestino` está vacío o ausente, se renderiza la celda como hoy.

### Compatibilidad
- Schema `parada.destino_agente` es `oneToOne` (confirmado en exploración) — el ascenso a raíz y la marcación por agente son determinísticos.
- El endpoint mono-agente sigue intacto: cualquier otro consumidor (incluida la UI vieja en caché) sigue funcionando.

## 4. Affected systems

| Sistema | Rol | Archivos |
|---------|-----|----------|
| Backend `api/recorrido` | Nuevo endpoint + servicio | `src/api/recorrido/services/recorrido.ts`, `src/api/recorrido/controllers/recorrido.ts`, `src/api/recorrido/routes/01-custom-hoja-de-ruta.ts` |
| Admin extension `AsignarAgente` | UI multi-select + accordion + badges | `src/admin/extensions/components/AsignarAgente/index.tsx`, `src/admin/extensions/components/AsignarAgente/types.ts`, `src/admin/extensions/components/AsignarAgente/HojaDeRutaTable.tsx` |
| Schema content-types | **Sin cambios** | (verificación de `parada.destino_agente` ya hecha en explore) |

## 5. Risks & open questions

### Risks
- **R1 — Payload size sin tope**: si el supervisor selecciona muchos agentes y todos tienen recorridos largos, la respuesta puede crecer. No hay `max-cap` impuesto en este change. **Mitigación**: monitorear en QA, agregar tope en un change futuro si se observa abuso.
- **R2 — `@strapi/design-system` transitiva**: `MultiSelect` viene de un paquete que hoy es dependencia transitiva, no directa. **Mitigación**: anotado como cleanup futuro, no bloquea este change pero debería resolverse antes de producción.
- **R3 — Forma del response del endpoint mono-agente**: definir en `spec` si el mono-agente empieza a devolver `agentesDestino` con un solo elemento (consistencia) o sigue sin el campo (back-compat puro). **Decisión a tomar en spec**.
- **R4 — Concurrencia de agentes en la misma parada**: el schema es `oneToOne` para `destino_agente`, así que **no debería haber** dos agentes destino en la misma parada en datos limpios. Pero el algoritmo multi-agente puede agrupar agentes que terminan en paradas distintas del mismo recorrido. Confirmar que la UI representa esto correctamente.

### Open questions
- **Q1 — UX cuando TODOS los agentes seleccionados están en `agentesNoEncontrados`**: ¿mostrar empty state con la lista de IDs no encontrados? ¿O un toast de error? **A definir en spec/design**.
- **Q2 — Orden de las hojas de ruta en el resultado**: ¿alfabético por raíz? ¿por orden de selección del primer agente que la "tocó"? **A definir en spec**.
- **Q3 — Color/estilo de los badges de agente**: ¿un color por agente (paleta determinística por documentId)? ¿Iniciales? **A definir en design**.

## 6. Success criteria

Al cerrar este change, debe cumplirse:

1. **Funcional — multi-agente**: un usuario puede seleccionar ≥2 agentes en el modal, hacer clic en "Generar hojas de ruta", y ver una o más hojas de ruta consolidadas.
2. **Funcional — deduplicación**: si dos agentes comparten raíz, aparece **una sola** `HojaDeRuta` y ambas paradas de destino muestran badges con el agente correspondiente.
3. **Funcional — accordion**: las hojas de ruta son expandibles independientemente; el usuario puede tener múltiples abiertas a la vez.
4. **Funcional — feedback de errores**: si algún agente del input no existe o no tiene parada inicial, aparece en `agentesNoEncontrados` y la UI lo comunica claramente.
5. **No-regresión — mono-agente**: el endpoint `GET /api/recorridos/hoja-de-ruta-por-agente/:id` y el servicio `resolverHojaDeRutaPorAgente` mantienen exactamente el mismo contrato (response shape, status codes).
6. **Performance — algoritmo O(raíces únicas)**: el nuevo servicio NO ejecuta N DFS independientes. Se valida con un test que mida llamadas a la función de expansión: para 5 agentes con 2 raíces compartidas, debe haber 2 expansiones, no 5.
7. **Tipos — backward compatible**: `ParadaExpandida.agentesDestino` es opcional. Código existente que no lo use compila sin cambios.
8. **Verificación**: sdd-verify reporta 0 CRITICAL.

---

**Next phases**: `sdd-spec` y `sdd-design` (pueden correr en paralelo).
