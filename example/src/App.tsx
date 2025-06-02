import React from 'react';
import { Text, View, StyleSheet, SafeAreaView, Button } from 'react-native';
import RNFS2 from 'react-native-fs2';


export default function App() {

  return (
    <SafeAreaView style={styles.container}>
      <Text>TODO: copy over example test cases from legacy RNFS2</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'red',
  },
});
