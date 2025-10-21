import { useState } from 'react';
import RNFS from 'react-native-fs2';
import { writeStream, readStream } from '../../src/_filestream';
import {
  StyleSheet,
  Text,
  View,
  Button,
  ActivityIndicator,
} from 'react-native';
import { getTestFolder, getFolderText } from './utils';

const Example = () => {
  const [runningAction, setRunningAction] = useState(false);
  const [result, setResult] = useState('');

  const executeExample = async () => {
    try {
      setResult('');
      setRunningAction(true);

      const folder = getTestFolder();
      let runStatus = '';

      // create directory RNFS2Example5Folder
      runStatus = `${runStatus}\n- Creating new directory "RNFS2Example5Folder"`;
      setResult(runStatus);
      await RNFS.mkdir(`${folder}/RNFS2Example5Folder`);
      runStatus = `${runStatus}\n- Directory Created`;
      setResult(runStatus);

      // write the file using stream
      const writePath = `${folder}/RNFS2Example5Folder/example5.txt`;
      runStatus = `${runStatus}\n- Writing to file using stream "example5.txt"`;
      setResult(runStatus);

      const text =
        'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?';
      await writeStream(writePath, text, 'utf8');
      runStatus = `${runStatus}\n- Wrote "example5.txt" using stream`;
      setResult(runStatus);

      // read file using stream and output content
      const readPath = `${folder}/RNFS2Example5Folder/example5.txt`;
      runStatus = `${runStatus}\n- Reading text file using stream "example5.txt"`;
      setResult(runStatus);

      const data = await readStream(readPath, 'utf8');
      runStatus = `${runStatus}\n- "example5.txt" contains: ${data}`;
      setResult(runStatus);
    } catch (err) {
      console.log(err);
      setResult(
        (currentResult) => currentResult + '\n- Error Running Example: ' + err
      );
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Example #5</Text>
      <Text style={styles.subTitle}>This example will:</Text>
      <Text style={styles.action}>
        - create a new directory inside your{' '}
        <Text style={styles.textBold}>{getFolderText()}</Text> called{' '}
        <Text style={styles.textBold}>RNFS2Example5Folder</Text>
      </Text>
      <Text style={styles.action}>
        - creates a new text file{' '}
        <Text style={styles.textBold}>example5.txt</Text> using stream
      </Text>
      <Text style={styles.action}>
        - reads the text file using stream and outputs the file content
        below:{' '}
      </Text>
      <View style={styles.statusWrapper}>
        {runningAction && <ActivityIndicator />}
        <Text>{result}</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        <Button title="Run Example5" color="#2644bc" onPress={executeExample} />
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
