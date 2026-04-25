import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    FlatList,
    Modal,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'de', label: 'German', native: 'Deutsch' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F3EFFE" />

      {/* Top decorative circles */}
      <View style={styles.circleTopLeft} />
      <View style={styles.circleTopRight} />

      {/* Main content */}
      <View style={styles.content}>
        {/* Logo / Icon placeholder */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoIcon}>🩺</Text>
        </View>

        {/* Title */}
        <Text style={styles.welcomeText}>Welcome to</Text>
        <Text style={styles.appName}>SkinPin</Text>
        <Text style={styles.tagline}>
          Your private, AI-powered{'\n'}skin health companion
        </Text>

        {/* Language selector */}
        <View style={styles.languageSection}>
          <Text style={styles.languageLabel}>Select your language</Text>
          <TouchableOpacity
            style={styles.languageButton}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={styles.languageButtonText}>
              {selectedLanguage.native}  ({selectedLanguage.label})
            </Text>
            <Text style={styles.chevron}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* Get Started button */}
        <TouchableOpacity
          style={styles.getStartedButton}
          onPress={() => router.replace('/(tabs)')}
          activeOpacity={0.85}
        >
          <Text style={styles.getStartedText}>Get Started →</Text>
        </TouchableOpacity>

        <Text style={styles.privacyNote}>🔒 All analysis stays on your device</Text>
      </View>

      {/* Bottom decorative circle */}
      <View style={styles.circleBottomRight} />

      {/* Language Picker Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Choose Language</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.languageOption,
                    item.code === selectedLanguage.code && styles.languageOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedLanguage(item);
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.languageOptionNative}>{item.native}</Text>
                  <Text style={styles.languageOptionLabel}>{item.label}</Text>
                  {item.code === selectedLanguage.code && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const LAVENDER = '#C4B5FD';
const LAVENDER_DARK = '#7C3AED';
const LAVENDER_BG = '#F3EFFE';
const LAVENDER_CARD = '#EDE9FE';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: LAVENDER_BG,
  },
  circleTopLeft: {
    position: 'absolute',
    top: -60,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: LAVENDER,
    opacity: 0.35,
  },
  circleTopRight: {
    position: 'absolute',
    top: -30,
    right: -40,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: LAVENDER,
    opacity: 0.25,
  },
  circleBottomRight: {
    position: 'absolute',
    bottom: -80,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: LAVENDER,
    opacity: 0.3,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: LAVENDER_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  logoIcon: {
    fontSize: 48,
  },
  welcomeText: {
    fontSize: 22,
    color: '#6B7280',
    fontWeight: '400',
    letterSpacing: 0.5,
  },
  appName: {
    fontSize: 52,
    fontWeight: '800',
    color: LAVENDER_DARK,
    letterSpacing: -1,
    marginTop: 4,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 48,
  },
  languageSection: {
    width: '100%',
    marginBottom: 24,
  },
  languageLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: 'center',
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderWidth: 1.5,
    borderColor: LAVENDER,
    shadowColor: LAVENDER_DARK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  languageButtonText: {
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
  },
  chevron: {
    fontSize: 18,
    color: LAVENDER_DARK,
  },
  getStartedButton: {
    width: '100%',
    backgroundColor: LAVENDER_DARK,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: LAVENDER_DARK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  getStartedText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  privacyNote: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
    textAlign: 'center',
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 6,
  },
  languageOptionSelected: {
    backgroundColor: LAVENDER_CARD,
  },
  languageOptionNative: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
  },
  languageOptionLabel: {
    fontSize: 14,
    color: '#9CA3AF',
    marginRight: 8,
  },
  checkmark: {
    fontSize: 18,
    color: LAVENDER_DARK,
    fontWeight: '700',
  },
});
