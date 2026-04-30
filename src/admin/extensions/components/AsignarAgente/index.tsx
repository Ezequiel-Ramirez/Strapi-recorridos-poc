import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
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
import { User, ArrowLeft } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import HojaDeRutaTable from './HojaDeRutaTable';
import type { HojaDeRuta, MultiAgenteResponse } from './types';

const RECORRIDO_LIST_PATH = '/content-manager/collection-types/api::recorrido.recorrido';
const PAGE_SIZE = 200;

interface Agente {
  documentId: string;
  IdAgente: string;
  RazonSocial: string;
}

interface ContentManagerResponse {
  results: Agente[];
  pagination: {
    page: number;
    pageCount: number;
  };
}

type Step = 'select' | 'result';

const sortByIdAgente = (a: Agente, b: Agente): number => {
  const numA = parseInt(a.IdAgente, 10);
  const numB = parseInt(b.IdAgente, 10);
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return a.IdAgente.localeCompare(b.IdAgente);
};

const AsignarAgenteButton: React.FC = () => {
  const location = useLocation();
  const { get, post } = useFetchClient();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('select');
  const [agentesSeleccionados, setAgentesSeleccionados] = useState<string[]>([]);
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loadingAgentes, setLoadingAgentes] = useState(false);
  const [loadingHojas, setLoadingHojas] = useState(false);
  const [resultado, setResultado] = useState<{
    hojas: HojaDeRuta[];
    agentesNoEncontrados: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!location.pathname.startsWith(RECORRIDO_LIST_PATH)) return null;

  const fetchAllAgentes = async (): Promise<Agente[]> => {
    const base = `/content-manager/collection-types/api::agente.agente?filters[Activo][$eq]=true&pageSize=${PAGE_SIZE}`;

    const first = await get<ContentManagerResponse>(`${base}&page=1`);
    const { results, pagination } = first.data;

    if (pagination.pageCount <= 1) return results;

    const remaining = await Promise.all(
      Array.from({ length: pagination.pageCount - 1 }, (_, i) =>
        get<ContentManagerResponse>(`${base}&page=${i + 2}`).then((r) => r.data.results)
      )
    );

    return results.concat(...remaining);
  };

  const handleOpen = async () => {
    setIsOpen(true);
    setLoadingAgentes(true);
    try {
      const todos = await fetchAllAgentes();
      setAgentes(todos.sort(sortByIdAgente));
    } finally {
      setLoadingAgentes(false);
    }
  };

  const resetState = () => {
    setStep('select');
    setAgentesSeleccionados([]);
    setResultado(null);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetState();
  };

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

  const handleVolver = () => {
    setStep('select');
    setResultado(null);
    setError(null);
  };

  const renderSelectStep = () => (
    <>
      <Modal.Body>
        {loadingAgentes ? (
          <Flex justifyContent="center" padding={6}>
            <Loader>Cargando agentes...</Loader>
          </Flex>
        ) : (
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
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" onClick={handleClose}>
          Cancelar
        </Button>
        <Button
          onClick={handleConfirmar}
          disabled={agentesSeleccionados.length === 0 || loadingAgentes || loadingHojas}
          loading={loadingHojas}
        >
          Generar hojas de ruta
        </Button>
      </Modal.Footer>
    </>
  );

  const renderResultStep = () => (
    <>
      <Modal.Body>
        {error ? (
          <Box padding={4}>
            <Typography textColor="danger600">{error}</Typography>
          </Box>
        ) : resultado === null ? (
          <Box padding={4}>
            <Typography textColor="neutral700">Sin resultados.</Typography>
          </Box>
        ) : (
          <Box>
            {resultado.agentesNoEncontrados.length > 0 && (
              <Box background="warning100" padding={3} hasRadius paddingBottom={4}>
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
                  <Accordion.Item
                    key={hoja.recorridoRaiz.documentId}
                    value={hoja.recorridoRaiz.documentId}
                  >
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
          </Box>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" onClick={handleVolver} startIcon={<ArrowLeft />}>
          Volver
        </Button>
        <Button onClick={handleClose}>Cerrar</Button>
      </Modal.Footer>
    </>
  );

  return (
    <Box>
      <Button startIcon={<User />} onClick={handleOpen} variant="secondary" size="S">
        Asignar Agente
      </Button>

      <Modal.Root open={isOpen} onOpenChange={(open: boolean) => { if (!open) handleClose(); }}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>
              {step === 'select' ? 'Asignar Agente al Recorrido' : 'Hojas de Ruta Generadas'}
            </Modal.Title>
          </Modal.Header>
          {step === 'select' ? renderSelectStep() : renderResultStep()}
        </Modal.Content>
      </Modal.Root>
    </Box>
  );
};

export default AsignarAgenteButton;
