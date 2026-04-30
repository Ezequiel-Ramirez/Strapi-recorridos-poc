import React from 'react';
import {
  Box,
  Typography,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Badge,
  Flex,
} from '@strapi/design-system';
import type { HojaDeRuta, ParadaExpandida, AgenteDetalle, RecorridoRef } from './types';

interface Props {
  hoja: HojaDeRuta;
}

const formatDetalle = (parada: ParadaExpandida): string => {
  if (parada.tipo === 'agente') {
    const a = parada.detalle as AgenteDetalle;
    return `${a.IdAgente} — ${a.RazonSocial} (${a.Ciudad})`;
  }
  if (parada.tipo === 'subruta') {
    const r = parada.detalle as RecorridoRef;
    return `${r.codigo} — ${r.descripcion}`;
  }
  return '—';
};

const HojaDeRutaTable: React.FC<Props> = ({ hoja }) => {
  const { recorridoRaiz, transportista, paradasExpandidas, warnings } = hoja;

  return (
    <Box paddingBottom={6}>
      <Box paddingBottom={3}>
        <Typography variant="beta" tag="h3">
          {recorridoRaiz.codigo} — {recorridoRaiz.descripcion}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          Transportista:{' '}
          {transportista
            ? `${transportista.IdTransportista} — ${transportista.Descripcion}`
            : 'Sin transportista asignado'}
        </Typography>
      </Box>

      {warnings && warnings.length > 0 && (
        <Box paddingBottom={3}>
          {warnings.map((w, i) => (
            <Typography key={i} variant="pi" textColor="warning600">
              ⚠ {w}
            </Typography>
          ))}
        </Box>
      )}

      <Table colCount={5} rowCount={paradasExpandidas.length}>
        <Thead>
          <Tr>
            <Th>
              <Typography variant="sigma">Orden</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">Recorrido</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">Nivel</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">Tipo</Typography>
            </Th>
            <Th>
              <Typography variant="sigma">Detalle</Typography>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {paradasExpandidas.map((parada, idx) => (
            <Tr
              key={`${parada.recorridoOrigen.documentId}-${parada.ordenVisita}-${idx}`}
              background={parada.esDestinoBuscado ? 'primary100' : undefined}
            >
              <Td>
                <Typography textColor="neutral800">{parada.ordenVisita}</Typography>
              </Td>
              <Td>
                <Box paddingLeft={parada.nivel * 4}>
                  <Typography textColor="neutral800">
                    {parada.recorridoOrigen.codigo}
                  </Typography>
                </Box>
              </Td>
              <Td>
                <Typography textColor="neutral600">{parada.nivel}</Typography>
              </Td>
              <Td>
                <Badge backgroundColor={parada.esDestinoBuscado ? 'primary500' : undefined}>
                  {parada.tipo}
                </Badge>
              </Td>
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
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Box>
  );
};

export default HojaDeRutaTable;
