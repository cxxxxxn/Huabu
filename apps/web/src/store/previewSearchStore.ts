// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { create } from 'zustand';

interface PreviewSearchState {
  nodeId: string | null;
  query: string;
  isOpen: boolean;
  focusInput: boolean;
  navigationRequest: { occurrenceIndex: number; nonce: number } | null;
  navigationSequence: number;
  open: (nodeId: string) => void;
  reveal: (nodeId: string, query: string, occurrenceIndex: number) => void;
  consumeNavigation: (nonce: number) => void;
  close: () => void;
  setQuery: (query: string) => void;
}

export const usePreviewSearchStore = create<PreviewSearchState>((set) => ({
  nodeId: null,
  query: '',
  isOpen: false,
  focusInput: false,
  navigationRequest: null,
  navigationSequence: 0,
  open: (nodeId) =>
    set({
      nodeId,
      query: '',
      isOpen: true,
      focusInput: true,
      navigationRequest: null,
    }),
  reveal: (nodeId, query, occurrenceIndex) =>
    set((state) => {
      const nonce = state.navigationSequence + 1;
      return {
        nodeId,
        query,
        isOpen: true,
        focusInput: false,
        navigationSequence: nonce,
        navigationRequest: { occurrenceIndex, nonce },
      };
    }),
  consumeNavigation: (nonce) =>
    set((state) =>
      state.navigationRequest?.nonce === nonce
        ? { navigationRequest: null }
        : {},
    ),
  close: () =>
    set({
      nodeId: null,
      query: '',
      isOpen: false,
      focusInput: false,
      navigationRequest: null,
    }),
  setQuery: (query) => set({ query, navigationRequest: null }),
}));
