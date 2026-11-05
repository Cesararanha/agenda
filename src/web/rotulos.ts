import type { Category } from '../shared/types.js';

export const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const NOME_CATEGORIA: Record<Category, string> = {
  faculdade: 'Faculdade',
  trabalho: 'Trabalho',
  projeto: 'Projeto',
  estudo: 'Estudo',
  pessoal: 'Pessoal',
  saude: 'Saúde',
  outro: 'Outro',
};
