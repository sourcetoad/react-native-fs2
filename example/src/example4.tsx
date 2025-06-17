import { useState } from 'react';
import RNFS from 'react-native-fs2';
import {
  StyleSheet,
  Text,
  View,
  Button,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { getTestFolder, getFolderText } from './utils';

const EXAMPLE_FOLDER = 'RNFS2Example4Folder';
const FILE_NAME = 'picsum.jpg';
const FILE_URL = 'https://picsum.photos/seed/picsum/200/300';

const FILE_NAME2 = 'picsum2.jpg';
const FILE_URL2 = 'https://picsum.photos/id/237/200/300';

const Example = () => {
  const [runningAction, setRunningAction] = useState(false);
  const [result, setResult] = useState('');
  const [imageURI, setImageURI] = useState('');

  const executeExample = async () => {
    setResult('');
    setRunningAction(true);
    try {
      const folder = getTestFolder();
      let runStatus = '';

      // Create example folder
      runStatus += `\n- Creating new directory "${EXAMPLE_FOLDER}"`;
      setResult(runStatus);
      await RNFS.mkdir(`${folder}/${EXAMPLE_FOLDER}`);
      runStatus += `\n- Directory Created`;
      setResult(runStatus);

      // Download file
      const filePath = `${folder}/${EXAMPLE_FOLDER}/${FILE_NAME}`;
      const filePath2 = `${folder}/${EXAMPLE_FOLDER}/${FILE_NAME2}`;
      runStatus += `\n- Downloading file from ${FILE_URL}`;
      setResult(runStatus);

      const jobId = Date.now();
      RNFS.downloadFile({
        fromUrl: FILE_URL,
        toFile: filePath,
        jobId,
        begin: (event) => {
          console.log('downloadFile begin', event);
        },
        progress: (event) => {
          console.log('downloadFile progress', event);
        },
        complete: async (event) => {
          console.log('downloadFile complete', event);

          runStatus += `\n- File downloaded to ${filePath}`;
          setResult(runStatus);

          // Stat file
          runStatus += `\n- Stat downloaded file`;
          setResult(runStatus);

          const fileStat = await RNFS.stat(filePath);
          runStatus += `\n- File stat: ${JSON.stringify(fileStat)}`;
          setResult(runStatus);

          setImageURI(
            Platform.OS === 'android' ? `file://${filePath}` : filePath
          );
        },
        error: (event) => {
          console.log('downloadFile error', event);
          setResult('Error Running Example: ' + event.error);
        },
        canBeResumed: (event) => {
          console.log('downloadFile canBeResumed', event);
        },
      });

      RNFS.downloadFile({
        fromUrl: FILE_URL2,
        toFile: filePath2,
        jobId,
        begin: (event) => {
          console.log('downloadFile begin', event);
        },
        progress: (event) => {
          console.log('downloadFile progress', event);
        },
        complete: async (event) => {
          console.log('downloadFile complete', event);
        },
        error: (event) => {
          console.log('downloadFile error', event);
        },
        canBeResumed: (event) => {
          console.log('downloadFile canBeResumed', event);
        },
      });
    } catch (err) {
      setResult('Error Running Example: ' + err);
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Example #4</Text>
      <Text style={styles.subTitle}>This example will:</Text>
      <Text style={styles.action}>
        - Download a file from <Text style={styles.textBold}>{FILE_URL}</Text>
      </Text>
      <Text style={styles.action}>
        - Save it to your <Text style={styles.textBold}>{getFolderText()}</Text>{' '}
        in <Text style={styles.textBold}>{EXAMPLE_FOLDER}</Text>
      </Text>
      <Text style={styles.action}>
        - Stat the downloaded file and display the result below
      </Text>
      <View style={styles.statusWrapper}>
        {runningAction && <ActivityIndicator />}
        <Text>{result}</Text>
      </View>
      <View>
        {!!imageURI && (
          <Image
            source={{ uri: imageURI }}
            style={{ width: 100, height: 100 }}
          />
        )}
      </View>
      <View style={{ marginTop: 10 }}>
        <Button title="Run Example4" color="#2644bc" onPress={executeExample} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  title: {
    fontWeight: 'bold',
    fontSize: 17,
  },
  subTitle: {
    paddingLeft: 10,
    fontSize: 14,
    fontWeight: 'bold',
  },
  action: {
    paddingLeft: 15,
    fontSize: 14,
  },
  wrapper: {
    flex: 1,
    alignItems: 'flex-start',
    padding: 10,
  },
  button: {
    flex: 0,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderColor: '#3c3636',
    backgroundColor: '#2644bc',
  },
  buttonText: {
    color: '#fff',
  },
  textBold: { fontWeight: 'bold' },
  statusWrapper: {
    padding: 20,
  },
});

export default Example;
