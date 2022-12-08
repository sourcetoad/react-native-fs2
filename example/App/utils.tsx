import {Platform, PermissionsAndroid} from 'react-native';
import RNFS from 'react-native-fs2';

export const getTestFolder = () => (Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.DownloadDirectoryPath);
export const getFolderText = () => {
  if (Platform.OS === 'ios') {
    return 'DocumentDirectory';
  }

  return 'DownloadDirectory';
};

export const requestAndroidPermission = async () => {
  return PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE, {
    title: 'Example Read/Write Storage Permission',
    message: 'Example App needs read/write access to your phone storage to save files',
    buttonNeutral: 'Ask Me Later',
    buttonNegative: 'Cancel',
    buttonPositive: 'OK',
  });
};
