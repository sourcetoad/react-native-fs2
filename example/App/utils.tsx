import {Platform} from 'react-native';
import RNFS from 'react-native-fs2';

export const getTestFolder = () => (Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath : RNFS.DownloadDirectoryPath);
