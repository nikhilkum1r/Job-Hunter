sed -i 's/editedProfile\.personal_information\.first_name/editedProfile?.personal_information?.first_name || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.personal_information\.last_name/editedProfile?.personal_information?.last_name || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.personal_information\.full_name/editedProfile?.personal_information?.full_name || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.contact_information\.email/editedProfile?.contact_information?.email || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.contact_information\.phone_primary/editedProfile?.contact_information?.phone_primary || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.contact_information\.current_location/editedProfile?.contact_information?.current_location || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.online_profiles\.linkedin/editedProfile?.online_profiles?.linkedin || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.online_profiles\.github/editedProfile?.online_profiles?.github || ""/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.work_experience/editedProfile?.work_experience/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.education/editedProfile?.education/g' dashboard/src/components/ProfileEditor.jsx
sed -i 's/editedProfile\.projects/editedProfile?.projects/g' dashboard/src/components/ProfileEditor.jsx
