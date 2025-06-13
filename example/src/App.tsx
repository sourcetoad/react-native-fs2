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

/**
 * Examples
 */
import Example1 from './example1';
import Example2 from './example2';
import Example3 from './example3';

const App = () => {
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

          <Example1 />
          <Example2 />
          <Example3 />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
