import { useState } from 'react';
import RNFS from 'react-native-fs2';
import {
  StyleSheet,
  Text,
  View,
  Button,
  Platform,
  ActivityIndicator,
  PermissionsAndroid,
} from 'react-native';
import {
  getTestFolder,
  getFolderText,
  requestAndroidPermission,
} from './utils';

const Example = () => {
  const [runningAction, setRunningAction] = useState(false);
  const [result, setResult] = useState('');

  /**
   * Methods
   */
  const executeExample = async () => {
    try {
      // cleanup previous result
      setResult('');

      setRunningAction(true);
      if (Platform.OS === 'android') {
        const granted = await requestAndroidPermission();

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setResult('Permission denied');
        }
      }

      const folder = getTestFolder();
      let runStatus = '';

      // create directory RNFS2Example2Folder1
      runStatus = `${runStatus}\n- Creating new directory "RNFS2Example2Folder1"`;
      setResult(runStatus);

      await RNFS.mkdir(`${folder}/RNFS2Example2Folder1`);

      runStatus = `${runStatus}\n- RNFS2Example2Folder1 Directory Created`;
      setResult(runStatus);

      // create directory RNFS2Example2Folder2
      runStatus = `${runStatus}\n- Creating new directory "RNFS2Example2Folder2"`;
      setResult(runStatus);

      await RNFS.mkdir(`${folder}/RNFS2Example2Folder2`);

      runStatus = `${runStatus}\n- RNFS2Example2Folder2 Directory Created`;
      setResult(runStatus);

      // write the file "folder1.txt"
      const folder1Path = `${folder}/RNFS2Example2Folder1/folder1.txt`;
      runStatus = `${runStatus}\n- Creating new text file "folder1.txt"`;
      setResult(runStatus);
      await RNFS.writeFile(folder1Path, '', 'utf8');

      // write the file "folder2.txt"
      const folder2Path = `${folder}/RNFS2Example2Folder2/folder2.txt`;
      runStatus = `${runStatus}\n- Creating new text file "folder2.txt"`;
      setResult(runStatus);
      await RNFS.writeFile(folder2Path, '', 'utf8');

      runStatus = `${runStatus}\n- Created "folder2.txt" File`;
      setResult(runStatus);

      // stat folder1.txt file
      runStatus = `${runStatus}\n- Stat "folder1.txt"`;
      setResult(runStatus);

      const folder1TextStat = await RNFS.stat(folder1Path);

      runStatus = `${runStatus}\n- "folder1.txt" stat: ${JSON.stringify(folder1TextStat)}`;
      setResult(runStatus);

      // stat folder2.txt file
      runStatus = `${runStatus}\n- Stat "folder2.txt"`;
      setResult(runStatus);

      const folder2TextStat = await RNFS.stat(folder2Path);

      runStatus = `${runStatus}\n- "folder2.txt" stat: ${JSON.stringify(folder2TextStat)}`;
      setResult(runStatus);

      // move folder1.txt to RNFS2Example2Folder2
      runStatus = `${runStatus}\n- Move "folder1.txt" to RNFS2Example2Folder2`;
      setResult(runStatus);

      const updatedFolder1Path = `${folder}/RNFS2Example2Folder2/folder1.txt`;
      await RNFS.moveFile(folder1Path, updatedFolder1Path);

      runStatus = `${runStatus}\n- "folder1.txt" moved to "RNFS2Example2Folder2" folder`;
      setResult(runStatus);

      // Read RNFS2Example2Folder2 directory
      runStatus = `${runStatus}\n- Listing files inside "RNFS2Example2Folder2"`;
      setResult(runStatus);

      const folder2Stat = await RNFS.readDir(`${folder}/RNFS2Example2Folder2`);

      if (folder2Stat?.length) {
        folder2Stat.forEach((file) => {
          runStatus = `${runStatus}\n   - ${file.name} -> ${file.path}`;
          setResult(runStatus);
        });
      }

      // Verify RNFS2Example2Folder1 is empty
      runStatus = `${runStatus}\n- Verify if "RNFS2Example2Folder1" is empty`;
      setResult(runStatus);

      const folder1Stat = await RNFS.readDir(`${folder}/RNFS2Example2Folder1`);
      runStatus = `${runStatus}\n- File count inside "RNFS2Example2Folder1": ${folder1Stat.length}`;
      setResult(runStatus);
    } catch (err) {
      console.log(err);
      setResult('Error Running Example');
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Example #2</Text>
      <Text style={styles.subTitle}>This example will:</Text>

      <Text style={styles.action}>
        - create a new directory inside your{' '}
        <Text style={styles.textBold}>{getFolderText()}</Text> called{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder1</Text>
      </Text>

      <Text style={styles.action}>
        - create a new directory inside your{' '}
        <Text style={styles.textBold}>{getFolderText()}</Text> called{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder2</Text>
      </Text>

      <Text style={styles.action}>
        - create a new text file inside{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder1</Text> called{' '}
        <Text style={styles.textBold}>folder1.txt</Text>
      </Text>

      <Text style={styles.action}>
        - create a new text file inside{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder2</Text> called{' '}
        <Text style={styles.textBold}>folder2.txt</Text>
      </Text>

      <Text style={styles.action}>
        - stat <Text style={styles.textBold}>folder1.txt</Text> file
      </Text>

      <Text style={styles.action}>
        - stat <Text style={styles.textBold}>folder2.txt</Text> file
      </Text>

      <Text style={styles.action}>
        - move <Text style={styles.textBold}>folder1.txt</Text> file to{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder2</Text>
      </Text>

      <Text style={styles.action}>
        - list all files inside{' '}
        <Text style={styles.textBold}>RNFS2Example2Folder2</Text> folder
      </Text>

      <Text style={styles.action}>
        - checks if <Text style={styles.textBold}>RNFS2Example2Folder2</Text>{' '}
        folder is empty
      </Text>

      <View style={styles.statusWrapper}>
        {runningAction && <ActivityIndicator />}
        <Text>{result}</Text>
      </View>

      <View style={{ marginTop: 10 }}>
        <Button title="Run Example2" color="#2644bc" onPress={executeExample} />
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
    borderTopWidth: 1,
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
