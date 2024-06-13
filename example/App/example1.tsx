import React, {useState} from 'react';
import RNFS from 'react-native-fs2';
import {StyleSheet, Text, View, Button, Platform, ActivityIndicator, PermissionsAndroid} from 'react-native';
import {getTestFolder, getFolderText, requestAndroidPermission} from './utils';

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

      // create directory RNFS2Example1Folder
      runStatus = `${runStatus}\n- Creating new directory "RNFS2Example1Folder"`;
      setResult(runStatus);

      await RNFS.mkdir(`${folder}/RNFS2Example1Folder`);

      runStatus = `${runStatus}\n- Directory Created`;
      setResult(runStatus);

      // write the file
      const writePath = `${folder}/RNFS2Example1Folder/example1.txt`;
      runStatus = `${runStatus}\n- Creating new text file "example1.txt"`;
      setResult(runStatus);
      await RNFS.writeFile(writePath, 'This is an example text file 12345.', 'utf8');

      runStatus = `${runStatus}\n- Created "example1.txt" File`;
      setResult(runStatus);

      // read file and output content
      const readPath = `${folder}/RNFS2Example1Folder/example1.txt`;

      runStatus = `${runStatus}\n- Reading text file "example1.txt"`;
      setResult(runStatus);

      const data = await RNFS.readFile(readPath, 'utf8');

      runStatus = `${runStatus}\n- "example1.txt" contains: ${data}`;
      setResult(runStatus);

      // array buffer
      runStatus = `${runStatus}\n- Reading ArrayBuffer from "example1.txt"`;
      setResult(runStatus);

      let osFilePath = readPath;
      if (Platform.OS === 'android') {
        osFilePath = `file://${readPath}`;
      }
      const arrayBuffer = await RNFS.readFile(osFilePath, 'arraybuffer');
      if (typeof arrayBuffer !== 'string') {
        setResult(`${runStatus}\n- Got ArrayBuffer - Size: ${arrayBuffer.byteLength}`);
      }
    } catch (err) {
      console.log(err);
      setResult('Error Running Example');
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Example #1</Text>
      <Text style={styles.subTitle}>This example will:</Text>

      <Text style={styles.action}>
        - create a new directory inside your <Text style={styles.textBold}>{getFolderText()}</Text> called{' '}
        <Text style={styles.textBold}>RNFS2Example1Folder</Text>
      </Text>

      <Text style={styles.action}>
        - creates a new text file <Text style={styles.textBold}>example1.txt</Text> inside
      </Text>

      <Text style={styles.action}>- reads the text file and outputs the file stat below: </Text>

      <View style={styles.statusWrapper}>
        {runningAction && <ActivityIndicator />}
        <Text>{result}</Text>
      </View>

      <View style={{marginTop: 10}}>
        <Button title="Run Example1" color="#2644bc" onPress={executeExample} />
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
  textBold: {fontWeight: 'bold'},
  statusWrapper: {
    padding: 20,
  },
});

export default Example;
