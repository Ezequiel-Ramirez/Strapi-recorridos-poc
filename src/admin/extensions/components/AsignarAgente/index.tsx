import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Button,
  Box,
  Modal,
  Combobox,
  ComboboxOption,
  Loader,
  Flex,
  Field,
  Typography,
} from '@strapi/design-system';
import { User, ArrowLeft } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import HojaDeRutaTable from './HojaDeRutaTable';
import type { HojaDeRuta, HojaDeRutaResponse } from './types';

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
  const { get } = useFetchClient();

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('select');
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<string>('');
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loadingAgentes, setLoadingAgentes] = useState(false);
  const [loadingHojas, setLoadingHojas] = useState(false);
  const [hojas, setHojas] = useState<HojaDeRuta[]>([]);
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
    setAgenteSeleccionado('');
    setHojas([]);
    setError(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    resetState();
  };

  const handleConfirmar = async () => {
    if (!agenteSeleccionado) return;
    setLoadingHojas(true);
    setError(null);
    try {
      const res = await get<HojaDeRutaResponse>(
        `/api/recorridos/hoja-de-ruta-por-agente/${agenteSeleccionado}`
      );
      setHojas(res.data.data ?? []);
      setStep('result');
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err?.message ?? 'Error al generar la ruta';
      setError(msg);
      setStep('result');
    } finally {
      setLoadingHojas(false);
    }
  };

  const handleVolver = () => {
    setStep('select');
    setHojas([]);
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
            <Field.Label>Agente</Field.Label>
            <Combobox
              placeholder="Buscá por ID o nombre..."
              value={agenteSeleccionado}
              onChange={(value: string) => setAgenteSeleccionado(value ?? '')}
            >
              {agentes.map((agente) => (
                <ComboboxOption key={agente.documentId} value={agente.documentId}>
                  {agente.IdAgente} — {agente.RazonSocial}
                </ComboboxOption>
              ))}
            </Combobox>
          </Field.Root>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="tertiary" onClick={handleClose}>
          Cancelar
        </Button>
        <Button
          onClick={handleConfirmar}
          disabled={!agenteSeleccionado || loadingAgentes || loadingHojas}
          loading={loadingHojas}
        >
          Confirmar
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
        ) : hojas.length === 0 ? (
          <Box padding={4}>
            <Typography textColor="neutral700">
              El agente no aparece en ningún recorrido.
            </Typography>
          </Box>
        ) : (
          <Box>
            <Typography variant="omega" textColor="neutral600">
              Se encontraron {hojas.length} hoja(s) de ruta para el agente seleccionado.
            </Typography>
            <Box paddingTop={4}>
              {hojas.map((hoja, i) => (
                <HojaDeRutaTable key={`${hoja.recorridoRaiz.documentId}-${i}`} hoja={hoja} />
              ))}
            </Box>
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
              {step === 'select' ? 'Asignar Agente al Recorrido' : 'Hoja de Ruta Generada'}
            </Modal.Title>
          </Modal.Header>
          {step === 'select' ? renderSelectStep() : renderResultStep()}
        </Modal.Content>
      </Modal.Root>
    </Box>
  );
};

export default AsignarAgenteButton;
