import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ENTRIES, type EntryKey } from '../entries';
import type { Report } from '../verify';

type Props = {
  onOpen: (key: EntryKey) => void;
  onClean: () => void;
  report: Report | null;
  verifyError: string | null;
};

/** One line of live status for the Run Test row, so the list is useful at a glance. */
function verifyStatus(report: Report | null, error: string | null): string {
  if (error) return 'harness error';
  if (!report) return 'running…';
  return `${report.passed} passed · ${report.failed} failed`;
}

const ExampleList = ({ onOpen, onClean, report, verifyError }: Props) => (
  <View style={styles.wrapper}>
    <View style={styles.topBar}>
      <Text style={styles.title}>Examples</Text>
      <Pressable
        style={({ pressed }) =>
          pressed ? styles.clearButtonPressed : styles.clearButton
        }
        onPress={onClean}
      >
        <Text style={styles.clearButtonText}>Clean Example Folders/Files</Text>
      </Pressable>
    </View>

    <Text style={styles.subTitle}>
      Run the examples below directly to your device or simulators
    </Text>

    <View style={styles.list}>
      {ENTRIES.map((entry) => {
        const isVerify = entry.key === 'verify';
        return (
          <Pressable
            key={entry.key}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onOpen(entry.key)}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{entry.title}</Text>
              <Text style={styles.rowSummary}>{entry.summary}</Text>
              {isVerify && (
                <Text
                  style={
                    verifyError || report?.failed
                      ? styles.rowStatusFail
                      : styles.rowStatus
                  }
                >
                  {verifyStatus(report, verifyError)}
                </Text>
              )}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

const styles = StyleSheet.create({
  wrapper: { flex: 1, padding: 10 },
  topBar: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 25 },
  subTitle: { fontSize: 16, color: '#555', marginTop: 8, marginBottom: 4 },
  list: { width: '100%', marginTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 6,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  rowPressed: { backgroundColor: '#eef1fb' },
  rowText: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowSummary: { fontSize: 13, color: '#666', marginTop: 2 },
  rowStatus: { fontSize: 12, color: '#137333', marginTop: 4 },
  rowStatusFail: {
    fontSize: 12,
    color: '#c5221f',
    marginTop: 4,
    fontWeight: '700',
  },
  chevron: { fontSize: 24, color: '#bbb' },
  clearButton: {
    backgroundColor: '#2644bc',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
  },
  clearButtonPressed: {
    backgroundColor: '#445ec6',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
  },
  clearButtonText: { color: '#fff', fontSize: 12 },
});

export default ExampleList;
