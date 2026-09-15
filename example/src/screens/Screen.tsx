import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  /** Only for screens whose body has no heading of its own; the examples each render one. */
  title?: string;
  busy: boolean;
  onBack: () => void;
  children: ReactNode;
};

/** The frame every detail screen shares: a back control, the title, then the example. */
const Screen = ({ title, busy, onBack, children }: Props) => (
  <View style={styles.wrapper}>
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={({ pressed }) => pressed && styles.backPressed}
      >
        <Text style={styles.back}>‹ Examples</Text>
      </Pressable>
      {busy && <Text style={styles.busy}>running…</Text>}
    </View>
    {title ? <Text style={styles.title}>{title}</Text> : null}
    {children}
  </View>
);

const styles = StyleSheet.create({
  wrapper: { flex: 1, padding: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  back: { fontSize: 17, color: '#2644bc' },
  backPressed: { opacity: 0.5 },
  busy: { fontSize: 13, color: '#8a6d00' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
});

export default Screen;
