import RNFS from 'react-native-fs2';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { getTestFolder, requestAndroidPermission } from './utils';
import { useEffect, useState } from 'react';
import { runVerification, type Report } from './verify';

/**
 * Examples
 */
import Example1 from './example1';
import Example2 from './example2';
import Example3 from './example3';
import Example4 from './example4';
import Example5 from './example5';

const App = () => {
  // Runs the on-device verification once on launch and renders the result. The unit suite
  // mocks native, so this is the only thing that exercises the Swift and Kotlin fixes.
  const [report, setReport] = useState<Report | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    runVerification()
      .then(setReport)
      .catch((e) => setVerifyError(e?.message ?? String(e)));
  }, []);

  // methods
  const cleanExampleFilesAndFolders = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await requestAndroidPermission();

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Android Permission Denied');
        }
      }
      const folder = getTestFolder();

      // Clean Example1 folder
      await RNFS.unlink(`${folder}/RNFS2Example1Folder`);

      // Clean Example2 folders
      await RNFS.unlink(`${folder}/RNFS2Example2Folder1`);
      await RNFS.unlink(`${folder}/RNFS2Example2Folder2`);
    } catch {
      console.log('Error Cleaning folders');
    } finally {
      Alert.alert('Successfully cleaned examples');
    }
  };

  return (
    <SafeAreaView>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ minHeight: '100%' }}
      >
        <View style={styles.wrapper}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.title}>Examples</Text>
            </View>

            <View>
              <Pressable
                style={({ pressed }) =>
                  !pressed ? styles.clearButton : styles.clearButtonPressed
                }
                onPress={cleanExampleFilesAndFolders}
              >
                <Text style={styles.clearButtonText}>
                  Clean Example Folders/Files
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.topBar}>
            <View>
              <Text style={styles.subTitle}>
                Run the examples below directly to your device or simulators
              </Text>
            </View>
          </View>

          <View style={styles.verifyBox}>
            <Text style={styles.subTitle}>On-device verification</Text>
            {verifyError && (
              <Text style={styles.verifyFail}>
                harness error: {verifyError}
              </Text>
            )}
            {!report && !verifyError && <Text>running…</Text>}
            {report && (
              <>
                <Text
                  style={report.failed ? styles.verifyFail : styles.verifyPass}
                >
                  {report.passed} passed · {report.failed} failed ·{' '}
                  {report.skipped} skipped
                </Text>
                {report.checks.map((c) => (
                  <Text
                    key={c.name}
                    style={
                      c.status === 'fail'
                        ? styles.verifyFail
                        : c.status === 'skip'
                          ? styles.verifySkip
                          : styles.verifyPass
                    }
                  >
                    {c.status === 'pass'
                      ? '✓'
                      : c.status === 'fail'
                        ? '✗'
                        : '–'}{' '}
                    {c.name} — {c.detail}
                  </Text>
                ))}
              </>
            )}
          </View>

          <Example1 />
          <Example2 />
          <Example3 />
          <Example4 />
          <Example5 />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  verifyBox: {
    width: '100%',
    marginVertical: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
  },
  verifyPass: { color: '#137333', fontSize: 12 },
  verifyFail: { color: '#c5221f', fontSize: 12, fontWeight: '700' },
  verifySkip: { color: '#8a8a8a', fontSize: 12 },
  title: {
    fontSize: 25,
  },
  subTitle: {
    fontSize: 18,
  },
  wrapper: {
    flex: 1,
    alignItems: 'flex-start',
    padding: 10,
  },
  topBar: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
  },
  highlight: {
    fontWeight: '700',
  },
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
  clearButtonText: {
    color: '#fff',
  },
});

export default App;
