import RNFS from 'react-native-fs2';
import {
  Alert,
  BackHandler,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTestFolder, requestAndroidPermission } from './utils';
import { runVerification, type Report } from './verify';
import { BusyContext } from './busy';
import { ENTRIES, type EntryKey } from './entries';
import ExampleList from './screens/ExampleList';
import Screen from './screens/Screen';
import VerifyScreen from './screens/VerifyScreen';

/**
 * React Native's own `SafeAreaView` is a no-op on Android, which left the header colliding
 * with the status bar clock and the Clean button sitting under the signal icons. Android 15
 * (API 35) draws edge-to-edge by default, so the inset has to be applied explicitly.
 *
 * `react-native-safe-area-context` would be the better tool and also covers the bottom
 * gesture bar, but adding it makes the library module's codegen emit
 * `RNCSafeAreaProviderManagerDelegate` a second time and the Android build fails on duplicate
 * dex classes. That is worth fixing on its own; it should not be fixed inside a UI change.
 */
const androidStatusBar =
  Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0;

const App = () => {
  // Which entry is open. `null` is the list.
  const [openKey, setOpenKey] = useState<EntryKey | null>(null);
  // Whether the open example is mid-run, reported up through BusyContext.
  const [busy, setBusy] = useState(false);

  // The verification run lives here rather than on its screen, so navigating away does not
  // cancel it and the report survives. It also keeps the launch behaviour the build scripts
  // rely on: the report is written to disk once, on start, with no interaction.
  const [report, setReport] = useState<Report | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const runVerify = useCallback(() => {
    setReport(null);
    setVerifyError(null);
    runVerification()
      .then(setReport)
      .catch((e) => setVerifyError(e?.message ?? String(e)));
  }, []);

  useEffect(runVerify, [runVerify]);

  const openEntry = useMemo(
    () => ENTRIES.find((e) => e.key === openKey) ?? null,
    [openKey]
  );

  // The single exit point, shared by the header control and Android's hardware back.
  const leave = useCallback(() => {
    if (!openKey) return false;
    if (!busy) {
      setOpenKey(null);
      return true;
    }
    Alert.alert(
      'Still running',
      `${openEntry?.title ?? 'This example'} hasn't finished. Leave anyway?`,
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            setBusy(false);
            setOpenKey(null);
          },
        },
      ]
    );
    return true;
  }, [busy, openKey, openEntry]);

  // Without this, hardware back exits the app from a detail screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', leave);
    return () => sub.remove();
  }, [leave]);

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

  const Body = openEntry?.component;

  return (
    <BusyContext.Provider value={setBusy}>
      <SafeAreaView style={[styles.safeArea, { paddingTop: androidStatusBar }]}>
        <StatusBar barStyle="dark-content" />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ minHeight: '100%' }}
        >
          {!openEntry && (
            <ExampleList
              onOpen={setOpenKey}
              onClean={cleanExampleFilesAndFolders}
              report={report}
              verifyError={verifyError}
            />
          )}

          {openEntry && (
            <Screen
              // The examples each render their own heading; only the verification screen
              // needs one supplied.
              title={openEntry.key === 'verify' ? openEntry.title : undefined}
              busy={busy}
              onBack={leave}
            >
              {openEntry.key === 'verify' ? (
                <VerifyScreen
                  report={report}
                  error={verifyError}
                  onRunAgain={runVerify}
                />
              ) : (
                Body && <Body />
              )}
            </Screen>
          )}
        </ScrollView>
      </SafeAreaView>
    </BusyContext.Provider>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
});

export default App;
