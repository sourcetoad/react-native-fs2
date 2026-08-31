import { Button, StyleSheet, Text, View } from 'react-native';
import type { Report } from '../verify';

type Props = {
  report: Report | null;
  error: string | null;
  onRunAgain: () => void;
};

/**
 * The verification report, lifted out of the old single-page layout.
 *
 * The run itself lives in the container, not here, so navigating away does not cancel it and
 * the report is still waiting when you come back.
 */
const VerifyScreen = ({ report, error, onRunAgain }: Props) => {
  const running = !report && !error;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.blurb}>
        Runs on launch and writes a JSON report next to the example files, which
        the build scripts read back with `simctl` / `adb`.
      </Text>

      <Button
        title={running ? 'Running…' : 'Run again'}
        color="#2644bc"
        onPress={onRunAgain}
        disabled={running}
      />

      {error && <Text style={styles.fail}>harness error: {error}</Text>}
      {running && <Text style={styles.running}>running…</Text>}

      {report && (
        <>
          <Text style={report.failed ? styles.fail : styles.pass}>
            {report.passed} passed · {report.failed} failed · {report.skipped}{' '}
            skipped
          </Text>
          <Text style={styles.meta}>
            {report.platform} {String(report.osVersion)} · {report.ranAt}
          </Text>
          {report.checks.map((c) => (
            <Text
              key={c.name}
              style={
                c.status === 'fail'
                  ? styles.fail
                  : c.status === 'skip'
                    ? styles.skip
                    : styles.pass
              }
            >
              {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'}{' '}
              {c.name} — {c.detail}
            </Text>
          ))}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { width: '100%', paddingVertical: 8 },
  blurb: { fontSize: 13, color: '#555', marginBottom: 12 },
  meta: { fontSize: 11, color: '#8a8a8a', marginBottom: 8 },
  running: { fontSize: 13, marginTop: 10 },
  pass: { color: '#137333', fontSize: 12, marginTop: 4 },
  fail: { color: '#c5221f', fontSize: 12, fontWeight: '700', marginTop: 4 },
  skip: { color: '#8a8a8a', fontSize: 12, marginTop: 4 },
});

export default VerifyScreen;
