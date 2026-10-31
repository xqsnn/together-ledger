'use client';

import { useEffect, useLayoutEffect } from 'react';

/** SSR 期间退化为 useEffect，避免 useLayoutEffect 的服务端警告。 */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
