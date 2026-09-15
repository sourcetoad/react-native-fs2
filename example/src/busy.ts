import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

/**
 * Lets the container know an example is mid-run, so going back can offer to stay rather than
 * throwing the run away.
 *
 * The examples each already track their own `runningAction` flag around the same try/finally,
 * so rather than lifting that state out of five components they swap `useState(false)` for
 * `useRunningState()` and report through this at the same time.
 */
export const BusyContext = createContext<(busy: boolean) => void>(() => {});

export function useRunningState(): [boolean, (running: boolean) => void] {
  const setBusy = useContext(BusyContext);
  const [running, setRunning] = useState(false);

  const set = useCallback(
    (value: boolean) => {
      setRunning(value);
      setBusy(value);
    },
    [setBusy]
  );

  // An example unmounted mid-run would otherwise leave the container believing something is
  // still going, and every later back press would prompt.
  useEffect(() => () => setBusy(false), [setBusy]);

  return [running, set];
}
