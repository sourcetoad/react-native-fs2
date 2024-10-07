import React, {useState} from 'react';
import {Image} from 'react-native';
import RNFS from 'react-native-fs2';

import {StyleSheet, Text, View, Button, Platform, ActivityIndicator, PermissionsAndroid} from 'react-native';
import {getTestFolder} from './utils';

const DUMMY_IMAGE =
  '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';

const Example = () => {
  const [runningAction, setRunningAction] = useState(false);
  const [result, setResult] = useState('');
  const [image, setImage] = useState('');
  const [imageURI, setImageURI] = useState('');

  const copyImageToMediaStore = async (
    imagePath: string,
    imageFileName: string,
    folderName = 'RNFS2Example3Folder',
    prefix = '',
    overwrite = '',
  ) => {
    if (Platform.OS === 'android') {
      // Check if file already exist on MediaStore
      const contentExists = await RNFS.MediaStore.existsInMediaStore(imagePath);

      if (contentExists) {
        // if overwrite flag is true then we replace the file with the new one
        if (overwrite) {
          // overwrite
          await RNFS.MediaStore.writeToMediaFile(imagePath, overwrite);
        }

        return imagePath;
      }

      const contentURI = await RNFS.MediaStore.copyToMediaStore(
        {
          name: `${prefix}${imageFileName}`,
          parentFolder: 'RNFSExample3Folder',
          mimeType: 'image/png',
        },
        RNFS.MediaStore.MEDIA_IMAGE,
        imagePath,
      );

      // TODO return content URI
      return contentURI;
    }

    /**
     * USE DocumentDirectory on iOS and DownloadDirectory on android
     *
     * Note:
     * DocumentDirectory not accessible on non-rooted android devices
     */
    const targetDirectory = getTestFolder();

    /**
     * Create UploadedImages folder if it does not exist
     */
    await RNFS.mkdir(`${targetDirectory}/${folderName}`);

    // generate destination path
    const destinationFolder = `${targetDirectory}/${folderName}`;
    const destinationPath = `${destinationFolder}/${prefix}${imageFileName}`;

    // Check if file already exist on the destination path
    const fileExist = await RNFS.exists(destinationPath);
    if (fileExist) {
      // if overwrite flag is true then we replace the file with the new one
      if (overwrite) {
        try {
          // attempt to delete existing file
          await RNFS.unlink(destinationPath);
        } catch {}

        // copy file to destination path
        await RNFS.copyFile(imagePath, destinationPath);

        return destinationPath;
      }

      return destinationPath;
    }

    // get file stat to ensure file is not corrupted
    // and to add another layer of check if RNFS.exists() fails to return the true value
    try {
      const fileStat = await RNFS.stat(destinationPath);
      if (fileStat?.size > 0 && fileStat?.isFile()) {
        return destinationPath;
      }
    } catch {
      console.log('File does not exist');
    }

    // otherwise copy file to destination path
    await RNFS.copyFile(imagePath, destinationPath);

    return destinationPath;
  };

  /**
   * Methods
   */
  const executeExample = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES, {
        title: 'RNFS2 Storage Permission',
        message: 'RNFS2 Example App needs read/write access to your phone storage to save images',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      });

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        /**
         * Android 13 does not need this permission anymore, so don't throw error
         */
        if (typeof Platform.Version === 'number' && Platform.Version < 33) {
          throw new Error('Permission denied');
        }
      }
    }

    let runStatus = '';
    try {
      const dummyImagePath = `${RNFS.DocumentDirectoryPath}/dummyImage2.png`;
      const dummyImageFile = await RNFS.exists(dummyImagePath);

      if (!dummyImageFile) {
        await RNFS.writeFile(dummyImagePath, DUMMY_IMAGE, 'base64');
      }

      const contentURI = await copyImageToMediaStore(
        imageURI || dummyImagePath,
        'dummyImage2.png',
        'RNFS2Example3Folder',
        'prefix',
        dummyImagePath,
      );

      setImageURI(contentURI);

      const contentResult = await RNFS.readFile(contentURI, 'base64');

      setImage(`data:image/png;base64,${contentResult}`);
    } catch (err) {
      console.log(err);
      setResult(`${runStatus}\n- Error Running Example`);
    } finally {
      setRunningAction(false);
    }
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.title}>Example #3</Text>
      <Text style={styles.subTitle}>This example will:</Text>

      <Text style={styles.action}>
        - Adds an entry to <Text style={styles.textBold}>MediaStore.Image</Text>
      </Text>

      <Text style={styles.action}>- access the image and displays it below </Text>
      <Text style={styles.action}>- Note: running the example again will overwrite existing media file</Text>

      <View style={styles.statusWrapper}>
        {runningAction && <ActivityIndicator />}
        <Text>{result}</Text>
      </View>

      <View>{!!image && <Image source={{uri: image}} style={{width: 100, height: 100}} />}</View>

      <View style={{marginTop: 10}}>
        <Button title="Run Example3" color="#2644bc" onPress={executeExample} />
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
