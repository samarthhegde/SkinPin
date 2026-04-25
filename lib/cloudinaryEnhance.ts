type CloudinaryEnhanceResult = {
  enhancedUri: string;
  usedCloudinary: boolean;
};

function cloudinaryConfig() {
  const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  return { cloudName, uploadPreset };
}

/**
 * Enhances image exposure/contrast through Cloudinary.
 * This uploads the photo and should only run when Sensitive Mode is OFF.
 */
export async function enhanceSkinPhotoForInference(
  photoUri: string,
  sensitiveMode: boolean
): Promise<CloudinaryEnhanceResult> {
  if (sensitiveMode) {
    return { enhancedUri: photoUri, usedCloudinary: false };
  }

  const { cloudName, uploadPreset } = cloudinaryConfig();
  if (!cloudName || !uploadPreset) {
    return { enhancedUri: photoUri, usedCloudinary: false };
  }

  const formData = new FormData();
  formData.append("file", {
    uri: photoUri,
    type: "image/jpeg",
    name: `privatecare_${Date.now()}.jpg`,
  } as unknown as Blob);
  formData.append("upload_preset", uploadPreset);
  formData.append("folder", "privatecare-inference");

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    return { enhancedUri: photoUri, usedCloudinary: false };
  }

  const payload = (await uploadRes.json()) as { secure_url?: string };
  if (!payload.secure_url) {
    return { enhancedUri: photoUri, usedCloudinary: false };
  }

  // Cloudinary delivery transformations: auto contrast + brightness + sharpen.
  const enhancedUri = payload.secure_url.replace(
    "/upload/",
    "/upload/e_auto_contrast,e_auto_brightness,e_sharpen:50/"
  );
  return { enhancedUri, usedCloudinary: true };
}
