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
} from '@strapi/design-system';
import { User } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';

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
  const [agenteSeleccionado, setAgenteSeleccionado] = useState<string>('');
  const [agentes, setAgentes] = useState<Agente[]>([]);
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    try {
      const todos = await fetchAllAgentes();
      setAgentes(todos.sort(sortByIdAgente));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setAgenteSeleccionado('');
  };

  return (
    <Box>
      <Button startIcon={<User />} onClick={handleOpen} variant="secondary" size="S">
        Asignar Agente
      </Button>

      <Modal.Root open={isOpen} onOpenChange={(open: boolean) => { if (!open) handleClose(); }}>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>Asignar Agente al Recorrido</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {loading ? (
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
            <Button onClick={handleClose} disabled={!agenteSeleccionado || loading}>
              Confirmar
            </Button>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
    </Box>
  );
};

export default AsignarAgenteButton;
