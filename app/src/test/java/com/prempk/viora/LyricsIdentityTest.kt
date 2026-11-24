package com.prempk.viora

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsIdentityTest {
    @Test fun exactTrackAndArtistAreAccepted() {
        val score = VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "Arijit Singh", "Tum Hi Ho", "Arijit Singh", 262, 261, true)
        assertNotNull(score)
        assertTrue(score!! >= 180)
    }

    @Test fun differentSongTitleIsRejected() {
        assertNull(VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "Arijit Singh", "Channa Mereya", "Arijit Singh", 262, 261, true))
    }

    @Test fun differentArtistIsRejected() {
        assertNull(VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "Arijit Singh", "Tum Hi Ho", "Atif Aslam", 262, 261, true))
    }

    @Test fun durationMismatchIsRejected() {
        assertNull(VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "Arijit Singh", "Tum Hi Ho", "Arijit Singh", 262, 330, true))
    }

    @Test fun titleOnlySearchRequiresVeryStrongMatch() {
        assertNotNull(VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "", "Tum Hi Ho", "Arijit Singh", 0, 0, false))
        assertNull(VioraApiProxy.lyricsMatchScore("Tum Hi Ho", "", "Tum Hi", "Arijit Singh", 0, 0, false))
    }
}