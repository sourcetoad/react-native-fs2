import React from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';

/**
 * Examples
 */
import Example1 from './example1';

const App = () => {
  return (
    <SafeAreaView>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{minHeight: '100%'}}>
        <View style={styles.wrapper}>
          <Text style={styles.title}>Examples</Text>
          <Text style={styles.subTitle}>Run the examples below directly to your device or simulators</Text>

          <Example1 />
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
});

export default App;
