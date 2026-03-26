/**
 * Canopy data point structure matching the TypeScript Cpoint format
 */
data class CanopyPoint(
    val millis: Long = 0,
    // canopy position relative to pilot
    val cpE: Double = 0.0,
    val cpD: Double = 0.0,
    val cpN: Double = 0.0,
    // canopy speed
    val vcpE: Double = 0.0,
    val vcpD: Double = 0.0,
    val vcpN: Double = 0.0,
    // aoa
    val cpaoa: Double = 0.0,
    // sustained
    val cpvxs: Double = 0.0,
    val cpvys: Double = 0.0,
    // roll
    val roll: Double = 0.0
)

/**
 * Compute wind-adjusted canopy orientation for a single time step using 90Hz predicted state
 * Converted from TypeScript computewindadjustedcanopyorientation function
 */
fun computeCanopyOrientation(
    predictedState: KalmanFilter3D.KFState,
    gpsaltitude: Double,
    currentMillis: Long,
    useRealOrientation: Boolean = false
): CanopyPoint {
    val GRAVITY = 9.80665 // m/s²

    // Get velocity components from predicted state (ENU coordinates)
    val vN = predictedState.velocity.z + predictedState.windVelocity.z  // North velocity
    val vE = predictedState.velocity.x + predictedState.windVelocity.x // East velocity
    val vD = -predictedState.velocity.y - predictedState.windVelocity.y// Down velocity (negative of up velocity)
    // Get velocity components from predicted state (ENU coordinates)
    val aN = predictedState.acceleration().z  // North velocity
    val aE = predictedState.acceleration().x  // East velocity
    val aD = -predictedState.acceleration().y // Down velocity (negative of up velocity)

    val vel = sqrt(vN * vN + vE * vE + vD * vD)

    val accelDminusG: Double = aD - GRAVITY


    // Calculate acceleration due to drag (projection onto velocity)



    val proj: Double = (aN * vN + aE * vE + accelDminusG * vD) / vel

    val dragN = proj * vN / vel
    val dragE = proj * vE / vel
    val dragD = proj * vD / vel

    // Calculate correct sign for drag
    val dragSign = -sign(dragN * vN + dragE * vE + dragD * vD)

    //val accelDrag = dragSign * sqrt(dragN * dragN + dragE * dragE + dragD * dragD)


    // Calculate acceleration due to lift (rejection from velocity)
    val liftN: Double = aN - dragN
    val liftE: Double = aE - dragE
    val liftD = accelDminusG - dragD
    // val accelLift = sqrt(liftN * liftN + liftE * liftE + liftD * liftD)

    // Wingsuit/pilot parameters
    val m = 77.5 // mass in kg
    val s = 2.0  // wing area in m²

    // Calculate atmospheric density
    val rho = AtmosphericModel.calculateDensity(gpsaltitude.toFloat(), 10f).toDouble()

    // Calculate pilot's drag contribution
    val dynamicPressure = rho * vel * vel / 2
    val pilotCd = 0.35
    val pilotAccelDrag = pilotCd * dynamicPressure * s / m

    // Pilot's drag components
    val pdragN = if (vel > 0) -vN / vel * pilotAccelDrag else 0.0
    val pdragE = if (vel > 0) -vE / vel * pilotAccelDrag else 0.0
    val pdragD = if (vel > 0) -vD / vel * pilotAccelDrag else 0.0

    // Calculate canopy normal force (subtract pilot's drag from total aerodynamic force)
    // Using predicted acceleration components
    val cnormN = liftN + dragN - pdragN
    val cnormE = liftE + dragE - pdragE
    val cnormD = liftD + dragD - pdragD

    // Canopy position relative to pilot
    //   .cpE * ((5.1 - .325) / 3) + (cdata[p].cplng - cdata[cur].cplng) * 111320 * Math.cos(cdata[p].cplat * Math.PI / 180), y: -cdata[p].cpD * ((5.1 - .325) / 3) + (cdata[cur].cpalt - cdata[p].cpalt), z: cdata[p].cpN * ((5.1 - .325) / 3
    val lineLength = if (useRealOrientation) 3.0 else 3.0 // meters from pilot's CG to aerodynamic center
    val magf = sqrt(cnormN * cnormN + cnormE * cnormE + cnormD * cnormD)

    val cpE = if (magf > 0) lineLength * cnormE / magf else 0.0
    val cpD = if (magf > 0) lineLength * cnormD / magf else 0.0
    val cpN = if (magf > 0) lineLength * cnormN / magf else 0.0

    // Global canopy position (simplified - would need proper coordinate conversion)
    //val cplat = gpsLocation.latitude + cpN / 111320.0
    //val cplng = gpsLocation.longitude + cpE / (111320.0 * cos(gpsLocation.latitude * PI / 180))
    //val cpalt = gpsLocation.altitude_gps - cpD

    // For single time step, canopy speed equals pilot speed (no rotation calculation)
    // In full implementation, this would use historical data for rotation speed
    val vcpE = vE
    val vcpD = vD
    val vcpN = vN

    // Calculate canopy AOA
    // Angle between canopy position vector and velocity vector
    val dot = cpE * vcpE + cpD * vcpD + cpN * vcpN
    val cpMag = sqrt(cpE * cpE + cpD * cpD + cpN * cpN)
    val vcpMag = sqrt(vcpE * vcpE + vcpD * vcpD + vcpN * vcpN)

    val anglenv = if (cpMag > 0 && vcpMag > 0) {
        PI - acos(dot / (cpMag * vcpMag))
    } else {
        0.0
    }

    val trimAngle = PI / 2 + 6 * PI / 180 // 6 degrees
    val cpaoa = PI - trimAngle - anglenv

    return CanopyPoint(
        millis = currentMillis,
        cpE = cpE,
        cpD = cpD,
        cpN = cpN,
        vcpE = vcpE,
        vcpD = vcpD,
        vcpN = vcpN,
        cpaoa = cpaoa,
        roll = predictedState.rollwind // Use roll from predicted state
    )
}







package com.platypii.baselinexr

// import com.platypii.baselinexr.measurements.MLocation // Unused
import android.util.Log
import androidx.core.net.toUri
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.Visible
import com.platypii.baselinexr.jarvis.FlightMode
import com.platypii.baselinexr.jarvis.EnhancedFlightMode
import com.platypii.baselinexr.location.AtmosphericModel
import com.platypii.baselinexr.location.KalmanFilter3D
import com.platypii.baselinexr.location.MotionEstimator
import com.platypii.baselinexr.location.PolarLibrary
import com.platypii.baselinexr.location.SimpleEstimator
import com.platypii.baselinexr.util.FlightAttitude
import com.platypii.baselinexr.util.HeadPoseUtil
import com.platypii.baselinexr.util.QuaternionUtil

import kotlin.math.*

/**
 * Canopy data point structure matching the TypeScript Cpoint format
 */
data class CanopyPoint(
    val millis: Long = 0,
    // canopy position relative to pilot
    val cpE: Double = 0.0,
    val cpD: Double = 0.0,
    val cpN: Double = 0.0,
    // canopy speed
    val vcpE: Double = 0.0,
    val vcpD: Double = 0.0,
    val vcpN: Double = 0.0,
    // aoa
    val cpaoa: Double = 0.0,
    // sustained
    val cpvxs: Double = 0.0,
    val cpvys: Double = 0.0,
    // roll
    val roll: Double = 0.0
)

/**
 * Compute wind-adjusted canopy orientation for a single time step using 90Hz predicted state
 * Converted from TypeScript computewindadjustedcanopyorientation function
 */
fun computeCanopyOrientation(
    predictedState: KalmanFilter3D.KFState,
    gpsaltitude: Double,
    currentMillis: Long,
    useRealOrientation: Boolean = false
): CanopyPoint {
    val GRAVITY = 9.80665 // m/s²

    // Get velocity components from predicted state (ENU coordinates)
    val vN = predictedState.velocity.z + predictedState.windVelocity.z  // North velocity
    val vE = predictedState.velocity.x + predictedState.windVelocity.x // East velocity
    val vD = -predictedState.velocity.y - predictedState.windVelocity.y// Down velocity (negative of up velocity)
    // Get velocity components from predicted state (ENU coordinates)
    val aN = predictedState.acceleration().z  // North velocity
    val aE = predictedState.acceleration().x  // East velocity
    val aD = -predictedState.acceleration().y // Down velocity (negative of up velocity)

    val vel = sqrt(vN * vN + vE * vE + vD * vD)

    val accelDminusG: Double = aD - GRAVITY


    // Calculate acceleration due to drag (projection onto velocity)



    val proj: Double = (aN * vN + aE * vE + accelDminusG * vD) / vel

    val dragN = proj * vN / vel
    val dragE = proj * vE / vel
    val dragD = proj * vD / vel

    // Calculate correct sign for drag
    val dragSign = -sign(dragN * vN + dragE * vE + dragD * vD)

    //val accelDrag = dragSign * sqrt(dragN * dragN + dragE * dragE + dragD * dragD)


    // Calculate acceleration due to lift (rejection from velocity)
    val liftN: Double = aN - dragN
    val liftE: Double = aE - dragE
    val liftD = accelDminusG - dragD
    // val accelLift = sqrt(liftN * liftN + liftE * liftE + liftD * liftD)

    // Wingsuit/pilot parameters
    val m = 77.5 // mass in kg
    val s = 2.0  // wing area in m²

    // Calculate atmospheric density
    val rho = AtmosphericModel.calculateDensity(gpsaltitude.toFloat(), 10f).toDouble()

    // Calculate pilot's drag contribution
    val dynamicPressure = rho * vel * vel / 2
    val pilotCd = 0.35
    val pilotAccelDrag = pilotCd * dynamicPressure * s / m

    // Pilot's drag components
    val pdragN = if (vel > 0) -vN / vel * pilotAccelDrag else 0.0
    val pdragE = if (vel > 0) -vE / vel * pilotAccelDrag else 0.0
    val pdragD = if (vel > 0) -vD / vel * pilotAccelDrag else 0.0

    // Calculate canopy normal force (subtract pilot's drag from total aerodynamic force)
    // Using predicted acceleration components
    val cnormN = liftN + dragN - pdragN
    val cnormE = liftE + dragE - pdragE
    val cnormD = liftD + dragD - pdragD

    // Canopy position relative to pilot
    //   .cpE * ((5.1 - .325) / 3) + (cdata[p].cplng - cdata[cur].cplng) * 111320 * Math.cos(cdata[p].cplat * Math.PI / 180), y: -cdata[p].cpD * ((5.1 - .325) / 3) + (cdata[cur].cpalt - cdata[p].cpalt), z: cdata[p].cpN * ((5.1 - .325) / 3
    val lineLength = if (useRealOrientation) 3.0 else 3.0 // meters from pilot's CG to aerodynamic center
    val magf = sqrt(cnormN * cnormN + cnormE * cnormE + cnormD * cnormD)

    val cpE = if (magf > 0) lineLength * cnormE / magf else 0.0
    val cpD = if (magf > 0) lineLength * cnormD / magf else 0.0
    val cpN = if (magf > 0) lineLength * cnormN / magf else 0.0

    // Global canopy position (simplified - would need proper coordinate conversion)
    //val cplat = gpsLocation.latitude + cpN / 111320.0
    //val cplng = gpsLocation.longitude + cpE / (111320.0 * cos(gpsLocation.latitude * PI / 180))
    //val cpalt = gpsLocation.altitude_gps - cpD

    // For single time step, canopy speed equals pilot speed (no rotation calculation)
    // In full implementation, this would use historical data for rotation speed
    val vcpE = vE
    val vcpD = vD
    val vcpN = vN

    // Calculate canopy AOA
    // Angle between canopy position vector and velocity vector
    val dot = cpE * vcpE + cpD * vcpD + cpN * vcpN
    val cpMag = sqrt(cpE * cpE + cpD * cpD + cpN * cpN)
    val vcpMag = sqrt(vcpE * vcpE + vcpD * vcpD + vcpN * vcpN)

    val anglenv = if (cpMag > 0 && vcpMag > 0) {
        PI - acos(dot / (cpMag * vcpMag))
    } else {
        0.0
    }

    val trimAngle = PI / 2 + 6 * PI / 180 // 6 degrees
    val cpaoa = PI - trimAngle - anglenv

    return CanopyPoint(
        millis = currentMillis,
        cpE = cpE,
        cpD = cpD,
        cpN = cpN,
        vcpE = vcpE,
        vcpD = vcpD,
        vcpN = vcpN,
        cpaoa = cpaoa,
        roll = predictedState.rollwind // Use roll from predicted state
    )
}
class WingsuitCanopySystem : SystemBase() {

    companion object {
        private const val TAG = "WingsuitCanopySystem"
        private const val WINGSUIT_SCALE = 0.5f
        private const val AIRPLANE_SCALE = 0.05f
        private const val CANOPY_SCALE = 0.08f
        private const val PC_SCALE = 2.0f
        private const val SNIVEL_SCALE = 1.0f
        private const val MODEL_HEIGHT_OFFSET = -3.0f
        private const val CANOPY_MODEL_HEIGHT_OFFSET = -0.3f
        private const val MIN_SPEED_THRESHOLD = 0.5 // m/s minimum speed to show models
        private const val ENLARGEMENT_FACTOR = 5f
        private const val VECTOR_SCALE = 0.1f // Scale factor for wind/airspeed vectors
        private const val VECTOR_OFFSET = 2.0f // Distance from models to show vectors
    }

    private var wingsuitEntity: Entity? = null
    private var airplaneEntity: Entity? = null
    private var canopyEntity: Entity? = null
    private var pcEntity: Entity? = null // Pilot chute for deployment
    private var snivelEntity: Entity? = null // Snivel for deployment
    private var windVectorEntity: Entity? = null
    private var airspeedVectorEntity: Entity? = null
    private var inertialspeedVectorEntity: Entity? = null
    private var magneticVectorEntity: Entity? = null // New: magnetic field vector
    private var initialized = false
    private var isEnlarged = false
    private var lastGpsTime: Long = 0 // Track when GPS data was last updated
    private final var isRealCanopyOrientation = true // Flag to control canopy positioning mode
    private var enableWindVectors = true // Flag to control wind vector display - now enabled
    private var enableMagneticVector = false // Flag to control magnetic field vector display
    
    // Reference to HeadModelSystem for updating head position/rotation
    private var headModelSystem: HeadModelSystem? = null

    /**
     * Get effective phone time for prediction calculations.
     * In mock mode, this accounts for pause duration so predictions don't jump forward.
     */
    private fun getEffectiveTime(): Long {
        return Services.location?.getEffectivePhoneTime() ?: System.currentTimeMillis()
    }

    override fun execute() {
        if (!initialized) {
            initializeModels()
        }
        
        // Get reference to HeadModelSystem if not already cached
        if (headModelSystem == null) {
            headModelSystem = systemManager.tryFindSystem<HeadModelSystem>()
        }

        // Update driven by 90Hz GpsToWorldTransform predictDelta() calls
        updateModelOrientationAndVisibility()
    }

    private fun initializeModels() {
        // Initial model alignment rotation (to fix model orientation) needs to be applied every time...
        val initialWingsuitRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (-Math.PI/2).toFloat()+Adjustments.yawAdjustment)
        val initialCanopyRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (-Math.PI/2).toFloat()+Adjustments.yawAdjustment)

        // Create wingsuit entity using tsimwingsuit.glb model with initial rotation
        wingsuitEntity = Entity.create(
            Mesh("tsimwingsuit.glb".toUri()),
            Transform(Pose(Vector3(0f), initialWingsuitRotation)),
            Scale(Vector3(WINGSUIT_SCALE)),
            Visible(false) // Start invisible
        )

        // Create airplane entity using airplane.glb model with same rotation as wingsuit
        airplaneEntity = Entity.create(
            Mesh("airplane.glb".toUri()),
            Transform(Pose(Vector3(0f), initialWingsuitRotation)),
            Scale(Vector3(AIRPLANE_SCALE)),
            Visible(false) // Start invisible
        )

        // Create canopy entity using cp2 model with initial rotation
        canopyEntity = Entity.create(
            Mesh("cp2.gltf".toUri()),
            Transform(Pose(Vector3(0f), initialCanopyRotation)),
            Scale(Vector3(CANOPY_SCALE)),
            Visible(false) // Start invisible
        )

        // Create pilot chute entity for deployment (use sphere as placeholder)
        pcEntity = Entity.create(
            Mesh("sphere.gltf".toUri()),
            Transform(Pose(Vector3(0f), Quaternion())),
            Scale(Vector3(PC_SCALE)),
            Visible(false) // Start invisible
        )

        // Create snivel entity for deployment (use cp2 scaled down as placeholder)
        snivelEntity = Entity.create(
            Mesh("cp2.gltf".toUri()),
            Transform(Pose(Vector3(0f), initialCanopyRotation)),
            Scale(Vector3(SNIVEL_SCALE * 0.3f)), // Smaller than full canopy
            Visible(false) // Start invisible
        )

        // Create vector entities for wind visualization (using arrow.glb model)
        windVectorEntity = Entity.create(
            Mesh("vectorb.glb".toUri()),
            Transform(Pose(Vector3(0f), Quaternion())),
            Scale(Vector3(VECTOR_SCALE)),
            Visible(false) // Start invisible
        )

        airspeedVectorEntity = Entity.create(
            Mesh("vectoro.glb".toUri()),
            Transform(Pose(Vector3(0f), Quaternion())),
            Scale(Vector3(VECTOR_SCALE)),
            Visible(false) // Start invisible
        )

        inertialspeedVectorEntity = Entity.create(
            Mesh("vectorp.glb".toUri()),
            Transform(Pose(Vector3(0f), Quaternion())),
            Scale(Vector3(VECTOR_SCALE)),
            Visible(false) // Start invisible
        )

        // Create magnetic field vector entity (using vectorb.glb - will appear cyan/green)
        magneticVectorEntity = Entity.create(
            Mesh("vectorb.glb".toUri()), // Reuse blue vector for magnetic field (appears cyan)
            Transform(Pose(Vector3(0f), Quaternion())),
            Scale(Vector3(VECTOR_SCALE)),
            Visible(false) // Start invisible
        )

        initialized = true
        Log.i(TAG, "WingsuitCanopySystem initialized with airplane, deployment models, wind vectors and magnetic field vector")
    }

    private fun updateModelOrientationAndVisibility() {
        // Check if wingsuit/canopy models are enabled
        if (!VROptions.current.showWingsuitCanopy) {
            hideAllModels()
            hideVectors()
            // But still show magnetic vector if we have sensor data
            if (enableMagneticVector) {
                val motionEstimator = Services.location.motionEstimator
                val lastUpdate = motionEstimator.getLastUpdate()
                val headPose = HeadPoseUtil.getHeadPose(systemManager)
                if (lastUpdate != null && headPose != null && headPose != Pose()) {
                    updateMagneticVector(lastUpdate.millis, headPose.t + Vector3(0f, MODEL_HEIGHT_OFFSET, 0f))
                }
            }
            return
        }

        val motionEstimator = Services.location.motionEstimator
        val lastUpdate = motionEstimator.getLastUpdate()

        // Get head position to place models near it
        val headPose = HeadPoseUtil.getHeadPose(systemManager) ?: return
        if (headPose == Pose()) return

        // Position models below and in front of the head
        val modelPosition = headPose.t + Vector3(0f, MODEL_HEIGHT_OFFSET, 0f)

        // Check if we have fresh GPS data and location is valid
        if (lastUpdate == null || !Services.location.isFresh) {
            // Hide all models and vectors when no GPS data
            hideAllModels()
            hideVectors()
            // But still show magnetic vector if we have sensor data
            if (enableMagneticVector && lastUpdate != null) {
                updateMagneticVector(lastUpdate.millis, headPose.t + Vector3(0f, MODEL_HEIGHT_OFFSET, 0f))
            }
            return
        }

        // Check if GPS data has been updated since last frame
        val hasNewGpsData = lastUpdate.millis != lastGpsTime
        if (hasNewGpsData) {
            lastGpsTime = lastUpdate.millis
        }

        // Check if moving fast enough
        if (lastUpdate.groundSpeed() < MIN_SPEED_THRESHOLD) {
            // Hide all models and vectors when not moving
            hideAllModels()
            hideVectors()
            // But still show magnetic vector if we have sensor data
            if (enableMagneticVector) {
                updateMagneticVector(lastUpdate.millis, headPose.t + Vector3(0f, MODEL_HEIGHT_OFFSET, 0f))
            }
            return
        }

        // Get enhanced flight mode
        val enhancedMode = Services.flightComputer.getEnhancedMode()

        // Update models based on enhanced flight mode
        when (enhancedMode) {
            EnhancedFlightMode.MODE_PLANE -> {
                // Show airplane, hide all others
                hideAllModels()
                updateAirplaneOrientation(motionEstimator, modelPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, modelPosition, FlightMode.MODE_PLANE)
                }
            }
            EnhancedFlightMode.MODE_WINGSUIT -> {
                // Show wingsuit, hide all others
                hideAllModels()
                updateWingsuitOrientation(motionEstimator, modelPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, modelPosition, FlightMode.MODE_WINGSUIT)
                }
            }
            EnhancedFlightMode.MODE_FREEFALL -> {
                // Show wingsuit, hide all others
                hideAllModels()
                updateWingsuitOrientation(motionEstimator, modelPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, modelPosition, FlightMode.MODE_FREEFALL)
                }
            }
            EnhancedFlightMode.MODE_DEPLOY -> {
                // Show wingsuit, pc, and snivel during deployment
                hideAllModels()
                updateDeploymentOrientation(motionEstimator, modelPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, modelPosition, FlightMode.MODE_CANOPY)
                }
            }
            EnhancedFlightMode.MODE_CANOPY -> {
                // Show canopy, hide all others
                hideAllModels()
                val canopyPosition = headPose.t + Vector3(0f, if (isRealCanopyOrientation) -0.3f else MODEL_HEIGHT_OFFSET, 0f)
                updateCanopyOrientation(motionEstimator, canopyPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, canopyPosition, FlightMode.MODE_CANOPY)
                }
            }
            EnhancedFlightMode.MODE_LANDING -> {
                // Show canopy (same as canopy mode for now)
                hideAllModels()
                val canopyPosition = headPose.t + Vector3(0f, if (isRealCanopyOrientation) -0.3f else MODEL_HEIGHT_OFFSET, 0f)
                updateCanopyOrientation(motionEstimator, canopyPosition, hasNewGpsData)
                if (enableWindVectors) {
                    updateWindVectors(motionEstimator, canopyPosition, FlightMode.MODE_CANOPY)
                }
            }
            else -> {
                // Unknown or ground mode - hide everything
                hideAllModels()
                hideVectors()
            }
        }

        // Update magnetic vector if enabled
        if (enableMagneticVector) {
            updateMagneticVector(lastUpdate.millis, modelPosition)
        }
    }

    /**
     * Hide all 3D models
     */
    private fun hideAllModels() {
        wingsuitEntity?.setComponent(Visible(false))
        airplaneEntity?.setComponent(Visible(false))
        canopyEntity?.setComponent(Visible(false))
        pcEntity?.setComponent(Visible(false))
        snivelEntity?.setComponent(Visible(false))
        headModelSystem?.hide()
    }

    /**
     * Update airplane orientation (uses same rotation logic as wingsuit)
     */
    private fun updateAirplaneOrientation(motionEstimator: MotionEstimator, position: Vector3, hasNewGpsData: Boolean) {
        val airplaneEntity = this.airplaneEntity ?: return

        // Use cached predicted state from 90Hz GpsToWorldTransform updates with interpolated parameters
        val (velocity, rollRad) = when (motionEstimator) {
            is KalmanFilter3D -> {
                // Get cached predicted state from last predictDelta() call with 90Hz interpolated roll
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                Pair(predictedState.velocity.plus(predictedState.windVelocity), predictedState.rollwind.toFloat())
            }
            is SimpleEstimator -> {
                Pair(motionEstimator.v, 0f)
            }
            else -> {
                // Fallback to GPS velocity if not a known estimator type
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    Pair(com.platypii.baselinexr.util.tensor.Vector3(lastUpdate.vE, lastUpdate.climb, lastUpdate.vN), 0f)
                } else {
                    return // No data available
                }
            }
        }

        // Calculate pitch (angle from horizontal)
        val horizontalSpeed = sqrt(velocity.x * velocity.x + velocity.z * velocity.z).toFloat()
        val pitchRad = atan2(-velocity.y.toFloat(), horizontalSpeed) // Negative because up is positive

        // Calculate flight yaw for +Z forward coordinate system
        // For +Z forward: yaw = atan2(vZ, vX) where vZ=North, vX=East
        val flightYaw = -atan2(velocity.z.toFloat(), velocity.x.toFloat())

        // No AOA adjustment for airplane - flies straight along velocity vector
        // Create two separate rotations and combine them
        // 1. Model offset
        val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (Math.PI).toFloat())

        // 2. Flight attitude
        val attitudeRotation = createQuaternionFromEuler(rollRad, pitchRad, (-flightYaw - Math.PI/2 - Adjustments.yawAdjustment).toFloat())

        // Combine rotations
        val rotation = multiplyQuaternions(modelRotation, attitudeRotation)

        // Use enlarged scale if enabled
        val scale = if (isEnlarged) AIRPLANE_SCALE * ENLARGEMENT_FACTOR else AIRPLANE_SCALE

        // Update airplane position and orientation
        airplaneEntity.setComponents(
            Transform(Pose(position, rotation)),
            Scale(Vector3(scale)),
            Visible(true)
        )
    }

    /**
     * Update deployment mode orientation - shows wingsuit, PC, and snivel
     */
    private fun updateDeploymentOrientation(motionEstimator: MotionEstimator, position: Vector3, hasNewGpsData: Boolean) {
        val wingsuitEntity = this.wingsuitEntity ?: return
        val pcEntity = this.pcEntity ?: return
        val snivelEntity = this.snivelEntity ?: return

        // Update wingsuit first (PC and snivel will position relative to it)
        val (velocity, rollRad) = when (motionEstimator) {
            is KalmanFilter3D -> {
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                Pair(predictedState.velocity.plus(predictedState.windVelocity), predictedState.rollwind.toFloat())
            }
            is SimpleEstimator -> {
                Pair(motionEstimator.v, 0f)
            }
            else -> {
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    Pair(com.platypii.baselinexr.util.tensor.Vector3(lastUpdate.vE, lastUpdate.climb, lastUpdate.vN), 0f)
                } else {
                    return
                }
            }
        }

        // Calculate pitch and yaw
        val horizontalSpeed = sqrt(velocity.x * velocity.x + velocity.z * velocity.z).toFloat()
        val pitchRad = atan2(-velocity.y.toFloat(), horizontalSpeed)
        val flightYaw = -atan2(velocity.z.toFloat(), velocity.x.toFloat())

        // Calculate AOA from measured KL/KD coefficients using polar data
        val aoaDeg = when (motionEstimator) {
            is KalmanFilter3D -> {
                //  val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                //  val kl = predictedState.kl()
                //  val kd = predictedState.kd()
                //  if (!kl.isNaN() && !kd.isNaN()) {
                //    val polarAoa = PolarLibrary.klkd2aoa(kl, kd)
                //   if (!polarAoa.isNaN()) polarAoa else 0.0
                0.0
            }
            else -> 0.0
        }
        val aoa = aoaDeg * Math.PI / 180

        // Wingsuit rotation
        val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat() + aoa.toFloat(), (Math.PI).toFloat())
        val attitudeRotation = createQuaternionFromEuler(rollRad, pitchRad, (-flightYaw - Math.PI/2 - Adjustments.yawAdjustment).toFloat())
        val wsRotation = multiplyQuaternions(modelRotation, attitudeRotation)

        // Update wingsuit
        val wsScale = if (isEnlarged) WINGSUIT_SCALE * ENLARGEMENT_FACTOR else WINGSUIT_SCALE
        wingsuitEntity.setComponents(
            Transform(Pose(position, wsRotation)),
            Scale(Vector3(wsScale)),
            Visible(true)
        )

        // PC positioned behind wingsuit (already deployed)
        // For now, position PC at origin - you can adjust this once basics work
        pcEntity.setComponents(
            Transform(Pose(position, Quaternion())),
            Scale(Vector3(PC_SCALE)),
            Visible(true)
        )

        // Snivel positioned same as canopy orientation during line stretch
        // Draw snivel similar to canopy orientation
        val canopyPoint = when (motionEstimator) {
            is KalmanFilter3D -> {
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    computeCanopyOrientation(predictedState, lastUpdate.altitude_gps, getEffectiveTime(), isRealCanopyOrientation)
                } else null
            }
            else -> null
        }

        if (canopyPoint != null) {
            // Scale and position snivel based on isRealCanopyOrientation flag (same as canopy)
            val snivelScale = if (isRealCanopyOrientation) 1.0f else CANOPY_SCALE

            // Position snivel: use offset only if isRealCanopyOrientation is true
            val snivelPosition = if (isRealCanopyOrientation) {
                // Real mode: position snivel above pilot using canopy physics offset
                val snivelOffset = Vector3(
                    -canopyPoint.cpE.toFloat(),
                    -canopyPoint.cpD.toFloat(),
                    canopyPoint.cpN.toFloat()
                )
                position + snivelOffset
            } else {
                // Simple mode: keep snivel at pilot position
                position
            }

            // Calculate snivel orientation from canopy velocity
            val cx = -canopyPoint.vcpE.toFloat()
            val cy = -canopyPoint.vcpD.toFloat()
            val cz = canopyPoint.vcpN.toFloat()
            val canopyHorizontalSpeed = sqrt(cx * cx + cz * cz)
            val canopyPitch = atan2(cy, canopyHorizontalSpeed)
            val canopyHeading = -atan2(cz, cx)

            // Snivel uses canopy orientation with AOA
            val snivelModelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (Math.PI).toFloat())
            val snivelAttitudeRotation = createQuaternionFromEuler(rollRad, canopyPitch, (-canopyHeading - Math.PI/2 - Adjustments.yawAdjustment).toFloat())
            val snivelAoaRotation = createQuaternionFromEuler(-canopyPoint.cpaoa.toFloat(), 0f, 0f)

            // Combine: model -> attitude -> aoa
            val snivelRotation = multiplyQuaternions(multiplyQuaternions(snivelModelRotation, snivelAttitudeRotation), snivelAoaRotation)

            snivelEntity.setComponents(
                Transform(Pose(snivelPosition, snivelRotation)),
                Scale(Vector3(snivelScale)),
                Visible(true)
            )
        } else {
            // Fallback: hide snivel if we can't compute orientation
            snivelEntity.setComponent(Visible(false))
        }
    }

    private fun updateWingsuitOrientation(motionEstimator: MotionEstimator, position: Vector3, hasNewGpsData: Boolean) {
        val wingsuitEntity = this.wingsuitEntity ?: return

        // Use cached predicted state from 90Hz GpsToWorldTransform updates with interpolated wingsuit parameters
        val (velocity, rollRad) = when (motionEstimator) {
            is KalmanFilter3D -> {
                // Get cached predicted state from last predictDelta() call with 90Hz interpolated roll
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                Pair(predictedState.velocity.plus(predictedState.windVelocity), predictedState.rollwind.toFloat())
            }
            is SimpleEstimator -> {
                Pair(motionEstimator.v, 0f)
            }
            else -> {
                // Fallback to GPS velocity if not a known estimator type
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    Pair(com.platypii.baselinexr.util.tensor.Vector3(lastUpdate.vE, lastUpdate.climb, lastUpdate.vN), 0f)
                } else {
                    return // No data available
                }
            }
        }

        // === LAYERED ROTATION ARCHITECTURE ===
        // Extract velocity in GPS conventions (vE=East, vUp=Up, vN=North)
        val vE = velocity.x
        val vUp = velocity.y
        val vN = velocity.z
        
        // Calculate heading and pitch using clean helpers
        val headingRad = QuaternionUtil.headingFromVelocity(vE, vN)
        val pitchRad = QuaternionUtil.pitchFromVelocity(vUp, vE, vN)

        // Calculate AOA from measured KL/KD coefficients using polar data
        val aoaDeg = when (motionEstimator) {
            is KalmanFilter3D -> {
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    PolarLibrary.convertKlKdToAOA(predictedState.kl, predictedState.kd, lastUpdate.altitude_gps,
                        PolarLibrary.AURA_FIVE_POLAR)
                } else {
                    10.0 // Default AOA if no GPS data
                }
            }
            else -> 10.0 // Default AOA for other estimators
        }
        val aoaRad = Math.toRadians(aoaDeg).toFloat()
        
        // === SHARED FLIGHT DATA ===
        // Package raw values for sharing with other visualization systems
        val flightAttitude = FlightAttitude(
            headingRad = headingRad,
            pitchRad = pitchRad,
            rollRad = rollRad,
            aoaRad = aoaRad,
            yawAdjustment = Adjustments.yawAdjustment.toFloat()
        )
        
        // === WINGSUIT-SPECIFIC ROTATION ===
        // Apply wingsuit model adjustments: +π to heading, -pitch+π, -AOA
        val attitudeRotation = QuaternionUtil.fromGpsAttitude(
            Math.PI.toFloat() + headingRad + Adjustments.yawAdjustment.toFloat(),
            -pitchRad + Math.PI.toFloat(),
            rollRad
        )
        val aoaRotation = QuaternionUtil.fromAoa(-aoaRad)
        val rotation = QuaternionUtil.multiply(aoaRotation, attitudeRotation)
        
        /* === OLD: Original calculation (commented for reference) ===
        // Calculate pitch (angle from horizontal)
        val horizontalSpeed = sqrt(velocity.x * velocity.x + velocity.z * velocity.z).toFloat()
        val pitchRad = atan2(-velocity.y.toFloat(), horizontalSpeed) // Negative because up is positive

        // Calculate flight yaw for +Z forward coordinate system
        // For +Z forward: yaw = atan2(vZ, vX) where vZ=North, vX=East
        val flightYaw = -atan2(velocity.z.toFloat(), velocity.x.toFloat())

        // Calculate AOA from measured KL/KD coefficients using polar data
        val aoaDeg = when (motionEstimator) {
            is KalmanFilter3D -> {
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    PolarLibrary.convertKlKdToAOA(predictedState.kl, predictedState.kd, lastUpdate.altitude_gps,
                        PolarLibrary.AURA_FIVE_POLAR)
                } else {
                    10.0 // Default AOA if no GPS data
                }
            }
            else -> 10.0 // Default AOA for other estimators
        }
        val aoa = aoaDeg * Math.PI / 180 // Convert to radians

        // Create two separate rotations and combine them
        // 1. Model  offset
        val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat()+aoa.toFloat(), (Math.PI).toFloat())

        // 2. Flight attitude
        val attitudeRotation = createQuaternionFromEuler(rollRad, pitchRad, (-flightYaw -Math.PI/2 -  Adjustments.yawAdjustment   ).toFloat())

        val rotation = multiplyQuaternions(modelRotation, attitudeRotation)
        === END OLD === */

        // Use enlarged scale if enabled
        val scale = if (isEnlarged) WINGSUIT_SCALE * ENLARGEMENT_FACTOR else WINGSUIT_SCALE

        // Update wingsuit position and orientation
        wingsuitEntity.setComponents(
            listOf(
                Scale(Vector3(scale)),
                Transform(Pose(position, rotation)),
                Visible(true)
            )
        )
        
        // Update head model with shared flight data (not the wingsuit-specific rotation)
        headModelSystem?.updateFromWingsuit(position, flightAttitude, scale)

        // ...removed per-frame debug logging...
    }

    private fun updateCanopyOrientation(motionEstimator: MotionEstimator, position: Vector3, hasNewGpsData: Boolean) {
        val canopyEntity = this.canopyEntity ?: return

        // Compute advanced canopy orientation using physics modeling
        val canopyPoint = when (motionEstimator) {
            is KalmanFilter3D -> {
                val predictedState = motionEstimator.getCachedPredictedState(getEffectiveTime())
                val lastUpdate = motionEstimator.getLastUpdate()
                if (lastUpdate != null) {
                    computeCanopyOrientation(predictedState, lastUpdate.altitude_gps, getEffectiveTime(), isRealCanopyOrientation)
                } else {
                    return // No GPS data available
                }
            }
            else -> {
                // Fallback to simple orientation for other estimators
                val velocity = when (motionEstimator) {
                    is SimpleEstimator -> motionEstimator.v
                    else -> {
                        val lastUpdate = motionEstimator.getLastUpdate()
                        if (lastUpdate != null) {
                            com.platypii.baselinexr.util.tensor.Vector3(lastUpdate.vE, lastUpdate.climb, lastUpdate.vN)
                        } else {
                            return // No data available
                        }
                    }
                }

                // Simple physics for non-Kalman estimators
                val horizontalSpeed = sqrt(velocity.x * velocity.x + velocity.z * velocity.z).toFloat()
                val pitchRad = atan2(-velocity.y.toFloat(), horizontalSpeed)
                val flightYaw = -atan2(velocity.z.toFloat(), velocity.x.toFloat())
                val rollRad = 0f // No roll data for simple estimators

                // Create simple rotations
                val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (Math.PI).toFloat())
                val attitudeRotation = createQuaternionFromEuler(rollRad, pitchRad, (-flightYaw - Math.PI/2 - Adjustments.yawAdjustment).toFloat())
                val rotation = multiplyQuaternions(modelRotation, attitudeRotation)

                // Update canopy with simple physics and return
                val scale = if (isRealCanopyOrientation) 1.0f else CANOPY_SCALE
                canopyEntity.setComponents(
                    listOf(
                        Scale(Vector3(scale)),
                        Transform(Pose(position, rotation)),
                        Visible(true)
                    )
                )
                return
            }
        }

        // Use advanced canopy physics results for orientation
        // Calculate flight attitude from velocity components in canopy point
        val horizontalSpeed = sqrt(canopyPoint.vcpE * canopyPoint.vcpE + canopyPoint.vcpN * canopyPoint.vcpN).toFloat()
        val pitchRad = atan2( canopyPoint.vcpD.toFloat(), horizontalSpeed) // Negative because up is positive
        val flightYaw = -atan2(canopyPoint.vcpN.toFloat(), canopyPoint.vcpE.toFloat()) // +Z forward coordinate system
        val rollRad = canopyPoint.roll.toFloat() // Use computed roll from canopy physics

        // Use computed AOA from canopy physics
        val aoa = (canopyPoint.cpaoa ).toFloat()

        // Create rotations using physics-based values
        // 1. Model offset with computed AOA
        val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat() + aoa, (Math.PI).toFloat())

        // 2. Flight attitude with physics-based roll
        val attitudeRotation = createQuaternionFromEuler(rollRad, pitchRad, (-flightYaw - Math.PI/2 - Adjustments.yawAdjustment).toFloat())

        // Combine rotations
        val rotation = multiplyQuaternions(modelRotation, attitudeRotation)

        // Use enlarged scale if enabled
        val scale = if (isRealCanopyOrientation) 1.0f else CANOPY_SCALE

        // Position calculation based on canopy orientation mode
        // Note: Position offset was never implemented - canopy always at head position
        val finalPosition = position

        // Update canopy position and orientation
        canopyEntity.setComponents(
            listOf(
                Scale(Vector3(scale)),
                Transform(Pose(finalPosition, rotation)),
                Visible(true)
            )
        )

        //-  Log.d(TAG, "Canopy: , pitch=${Math.toDegrees(pitchRad.toDouble())}°, yaw=${Math.toDegrees(flightYaw.toDouble())}°, roll=${Math.toDegrees(rollRad.toDouble())}°,aoa=${Math.toDegrees(canopyPoint.cpaoa.toDouble())}°")
    }

    /**
     * Create a quaternion from Euler angles (roll, pitch, yaw) in radians
     * Meta Spatial uses Y-up coordinate system
     * Order: Y(yaw) * X(pitch) * Z(roll) - intrinsic rotations
     */
    private fun createQuaternionFromEuler(roll: Float, pitch: Float, yaw: Float): Quaternion {
        // Convert to half angles
        val halfYaw = yaw * 0.5f
        val halfPitch = pitch * 0.5f
        val halfRoll = roll * 0.5f

        val cy = cos(halfYaw)
        val sy = sin(halfYaw)
        val cp = cos(halfPitch)
        val sp = sin(halfPitch)
        val cr = cos(halfRoll)
        val sr = sin(halfRoll)


        // Quaternion multiplication: q_yaw * q_pitch * q_roll
        // Y-up, Order: Y(yaw) * X(pitch) * Z(roll) - intrinsic rotations
        val qw = cy * cp * cr + sy * sp * sr
        val qx = cy * sp * cr + sy * cp * sr
        val qy = sy * cp * cr - cy * sp * sr
        val qz = cy * cp * sr - sy * sp * cr

        return Quaternion(qx, qy, qz, qw)
    }

    /**
     * Multiply two quaternions: q1 * q2
     * This applies q1 first, then q2
     */
    private fun multiplyQuaternions(q1: Quaternion, q2: Quaternion): Quaternion {
        val w = q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
        val x = q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y
        val y = q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x
        val z = q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w

        return Quaternion(x, y, z, w)
    }

    /**
     * Update wind, airspeed, and inertial speed vectors
     */
    private fun updateWindVectors(motionEstimator: MotionEstimator, basePosition: Vector3, flightMode: Int) {
        val lastUpdate = motionEstimator.getLastUpdate() ?: return

        // Get velocity components and wind velocity from predicted state (ENU coordinates)
        val (inertialVelocity, windVelocity) = when (motionEstimator) {
            is KalmanFilter3D -> {
                val currentTime = getEffectiveTime()
                val predictedState = motionEstimator.getCachedPredictedState(currentTime)
                // ...removed per-frame debug logging...
                Pair(predictedState.velocity, predictedState.windVelocity)
            }
            is SimpleEstimator -> {
                // Simple estimator doesn't have wind velocity, use zero wind
                val zeroWind = com.platypii.baselinexr.util.tensor.Vector3(0.0, 0.0, 0.0)
                // ...removed per-frame debug logging...
                Pair(motionEstimator.v, zeroWind)
            }
            else -> {
                // Fallback estimator doesn't have wind velocity, use zero wind
                val velocity = com.platypii.baselinexr.util.tensor.Vector3(lastUpdate.vE, lastUpdate.climb, lastUpdate.vN)
                val zeroWind = com.platypii.baselinexr.util.tensor.Vector3(0.0, 0.0, 0.0)
                // ...removed per-frame debug logging...
                Pair(velocity, zeroWind)
            }
        }

        // Use wind velocity directly from predicted state (already in ENU coordinates)
        val wvi = windVelocity

        // Debug: Log wind velocity from predicted state
        val windMag = sqrt(wvi.x * wvi.x + wvi.y * wvi.y + wvi.z * wvi.z)
        // ...removed per-frame debug logging...

        // Calculate airspeed (velocity relative to air mass)
        val airspeedVector = com.platypii.baselinexr.util.tensor.Vector3(
            inertialVelocity.x + wvi.x, // East airspeed
            inertialVelocity.y + wvi.y, // Up airspeed
            inertialVelocity.z + wvi.z  // North airspeed
        )

        // Position airspeed and inertial speed vectors at the same position as wingsuit
        val vectorBasePos = basePosition

        // Calculate tip of inertial velocity vector for wind vector positioning
        val inertialMagnitude = sqrt(inertialVelocity.x * inertialVelocity.x + inertialVelocity.y * inertialVelocity.y + inertialVelocity.z * inertialVelocity.z)
        val windVectorPos = if (inertialMagnitude > 0.1) {
            // Position wind vector at tip of inertial velocity vector
            // Apply yaw adjustment to positioning
            val normalizedInertial = com.platypii.baselinexr.util.tensor.Vector3(
                inertialVelocity.x / inertialMagnitude,
                inertialVelocity.y / inertialMagnitude,
                inertialVelocity.z / inertialMagnitude
            )

            // Apply yaw adjustment rotation to the normalized velocity vector
            val yawAdj = -Adjustments.yawAdjustment
            val cosYaw = cos(yawAdj)
            val sinYaw = sin(yawAdj)

            // Rotate the normalized inertial vector by yaw adjustment
            val rotatedX = normalizedInertial.x * cosYaw - normalizedInertial.z * sinYaw
            val rotatedZ = normalizedInertial.x * sinYaw + normalizedInertial.z * cosYaw

            // Scale the tip position by actual velocity magnitude / 50
            val tipDistance = (inertialMagnitude * (VECTOR_SCALE / 5.0)).toFloat()
            basePosition + Vector3(
                (rotatedX * tipDistance).toFloat(),
                (normalizedInertial.y * tipDistance).toFloat(),
                (rotatedZ * tipDistance).toFloat()
            )
        } else {
            // If not moving, position wind vector at base position
            basePosition
        }

        // Debug wind vector data
        val windMagnitude = sqrt(wvi.x * wvi.x + wvi.y * wvi.y + wvi.z * wvi.z)
        // ...removed per-frame debug logging...

        // Update vectors with new positioning and rotation system
        updateVectorWithQuaternions(airspeedVectorEntity, vectorBasePos, airspeedVector, "airspeed")
        updateVectorWithQuaternions(inertialspeedVectorEntity, vectorBasePos, inertialVelocity, "inertial")
        updateVectorWithQuaternions(windVectorEntity, windVectorPos, wvi, "wind")

        // ...removed per-frame debug logging...
    }

    /**
     * Update a single vector entity using the same quaternion rotation system as wingsuit
     */
    private fun updateVectorWithQuaternions(entity: Entity?, position: Vector3, vector: com.platypii.baselinexr.util.tensor.Vector3, name: String, scaleMultiplier: Float = 1.0f) {
        entity ?: run {
            // ...removed per-frame debug logging...
            return
        }

        val magnitude = sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)

        // Hide vector if too small - use different thresholds for different vectors
        val minThreshold = when (name) {
            "wind" -> 0.1 // Lower threshold for wind vector (wind can be very light)
            "Magnetic" -> 0.1 // Lower threshold for magnetic field (typically 0.3-0.6 gauss)
            else -> 0.5   // Higher threshold for velocity vectors
        }

        if (magnitude < minThreshold) {
            entity.setComponent(Visible(false))
            // ...removed per-frame debug logging...
            return
        }

        // ...removed per-frame debug logging...

        // Calculate pitch (angle from horizontal) - same as wingsuit
        val horizontalSpeed = sqrt(vector.x * vector.x + vector.z * vector.z).toFloat()
        val pitchRad = atan2(-vector.y.toFloat(), horizontalSpeed) // Negative because up is positive

        // Calculate flight yaw for +Z forward coordinate system - same as wingsuit
        val flightYaw = -atan2(vector.z.toFloat(), vector.x.toFloat())

        // Create two separate rotations and combine them - same as wingsuit (without AOA)
        // 1. Model offset rotation - same as wingsuit initial rotation
        val modelRotation = createQuaternionFromEuler(0f, (Math.PI).toFloat(), (Math.PI).toFloat())

        // 2. Flight attitude rotation - same as wingsuit (no roll for vectors)
        val attitudeRotation = createQuaternionFromEuler( 0f, pitchRad, (-flightYaw - Math.PI/2 - Adjustments.yawAdjustment).toFloat())

        // Combine rotations: first apply offset, then attitude - same as wingsuit
        val rotation = multiplyQuaternions(modelRotation, attitudeRotation)

        // Scale by total velocity / 5 as requested, no minimum scale to match geometry
        // Apply scaleMultiplier for vectors that need custom scaling (e.g., magnetic field)
        val scale = VECTOR_SCALE * (magnitude / 5.0).toFloat() * scaleMultiplier

        entity.setComponents(
            listOf(
                Scale(Vector3(scale)),
                Transform(Pose(position, rotation)),
                Visible(true)
            )
        )

        // ...removed per-frame debug logging...
    }

    /**
     * Hide all wind vectors (but not magnetic vector)
     */
    private fun hideVectors() {
        windVectorEntity?.setComponent(Visible(false))
        airspeedVectorEntity?.setComponent(Visible(false))
        inertialspeedVectorEntity?.setComponent(Visible(false))
        // Don't hide magnetic vector here - it's controlled independently
    }

    /**
     * Update magnetic field vector from sensor data
     * Shows the compass/magnetometer reading as a 3D vector
     */
    private fun updateMagneticVector(gpsMillis: Long, basePosition: Vector3) {
        val magneticEntity = this.magneticVectorEntity ?: run {
            // ...removed per-frame debug logging...
            return
        }

        // Check if mock sensor data is configured
        if (VROptions.current.mockSensor == null) {
            // No mock sensor configured - hide magnetic vector
            magneticEntity.setComponent(Visible(false))
            return
        }

        // Check if sensor provider is available and started
        val sensorProvider = Services.location.getSensorProvider()
        if (sensorProvider == null) {
            Log.w(TAG, "MAGVEC: Sensor provider is null!")
            magneticEntity.setComponent(Visible(false))
            return
        }

        // Check if sensor data is actually loaded
        if (!sensorProvider.hasSensorData()) {
            magneticEntity.setComponent(Visible(false))
            return
        }

        // Get sensor data synchronized to GPS time
        val sensorData = sensorProvider.getSensorAtTime(gpsMillis)

        if (sensorData == null) {
            Log.w(TAG, "MAGVEC: No sensor data available for GPS time $gpsMillis - sensor provider may not be started or data not loaded")
            magneticEntity.setComponent(Visible(false))
            return
        }

        // ...removed per-frame debug logging...

        // Sensor data from parser always has valid MAG values (parser only creates entries when MAG data exists)
        // ...removed per-frame debug logging...

        // Get magnetic field vector in sensor's local frame (gauss)
        // FlySight magnetometer internal frame: X=East, Y=North, Z=Down
        // Mounted sensor orientation: Forward=-Z, Up=+Y, Right=+X
        // Transform from sensor internal → mounted → ENU world coordinates
        val magVectorLocal = com.platypii.baselinexr.util.tensor.Vector3(
            sensorData.magX.toDouble(),   // Right (X) = East
            -sensorData.magZ.toDouble(),  // Up (Y) = -Down
            -sensorData.magY.toDouble()   // Forward (Z) = -North
        )

        // Get headset pose to transform sensor data from local to world coordinates
        val headPose = HeadPoseUtil.getHeadPose(systemManager)
        if (headPose == null) {
            Log.w(TAG, "MAGVEC: No headset pose available")
            magneticEntity.setComponent(Visible(false))
            return
        }

        // Rotate magnetic vector from sensor's local frame to world frame using headset rotation
        val headRotation = headPose.q
        val magVectorWorld = rotateVectorByQuaternion(magVectorLocal, headRotation)

        val magMagnitude = sqrt(magVectorWorld.x * magVectorWorld.x + magVectorWorld.y * magVectorWorld.y + magVectorWorld.z * magVectorWorld.z)
        // ...removed per-frame debug logging...

        // Scale vector for visualization (magnetic field is ~0.5 gauss, needs larger scale)
        val scaleMultiplier = 10f // Scale magnetic vector 10x larger for visibility

        // Position magnetic vector offset from model
        val vectorPosition = basePosition + Vector3(-VECTOR_OFFSET, 0f, 0f) // Offset to left
        // ...removed per-frame debug logging...

        // Update vector using quaternion rotation with custom scale multiplier
        // ...removed per-frame debug logging...
        updateVectorWithQuaternions(magneticEntity, vectorPosition, magVectorWorld, "Magnetic", scaleMultiplier)

        // ...removed per-frame debug logging...
    }

    /**
     * Rotate a vector by a quaternion
     * Transforms vector from one coordinate frame to another using quaternion rotation
     */
    private fun rotateVectorByQuaternion(vector: com.platypii.baselinexr.util.tensor.Vector3, q: Quaternion): com.platypii.baselinexr.util.tensor.Vector3 {
        // Convert vector to quaternion with w=0
        val vecQuat = Quaternion(vector.x.toFloat(), vector.y.toFloat(), vector.z.toFloat(), 0f)

        // Calculate quaternion conjugate (inverse rotation)
        val qConj = Quaternion(-q.x, -q.y, -q.z, q.w)

        // Apply rotation: q * v * q^-1
        val temp = multiplyQuaternions(q, vecQuat)
        val result = multiplyQuaternions(temp, qConj)

        return com.platypii.baselinexr.util.tensor.Vector3(
            result.x.toDouble(),
            result.y.toDouble(),
            result.z.toDouble()
        )
    }

    // Helper extension function for Float formatting
    private fun Float.format(decimals: Int): String = "%.${decimals}f".format(this)

    fun setEnlarged(enlarged: Boolean) {
        isEnlarged = enlarged
    }

    /**
     * Enable or disable wind vector display
     */
    fun setWindVectorsEnabled(enabled: Boolean) {
        enableWindVectors = enabled
        if (!enabled) {
            // Hide all wind vectors when disabled
            hideWindVectors()
        }
        Log.i(TAG, "Wind vectors ${if (enabled) "enabled" else "disabled"}")
    }

    /**
     * Check if wind vectors are currently enabled
     */
    fun isWindVectorsEnabled(): Boolean {
        return enableWindVectors
    }

    /**
     * Hide all wind vector entities
     */
    private fun hideWindVectors() {
        windVectorEntity?.setComponent(Visible(false))
        airspeedVectorEntity?.setComponent(Visible(false))
        inertialspeedVectorEntity?.setComponent(Visible(false))
    }

    /**
     * Enable or disable magnetic field vector display
     */
    fun setMagneticVectorEnabled(enabled: Boolean) {
        enableMagneticVector = enabled
        if (!enabled) {
            magneticVectorEntity?.setComponent(Visible(false))
        }
        Log.i(TAG, "Magnetic vector ${if (enabled) "enabled" else "disabled"}")
    }

    /**
     * Check if magnetic vector is currently enabled
     */
    fun isMagneticVectorEnabled(): Boolean {
        return enableMagneticVector
    }

    fun cleanup() {
        wingsuitEntity = null
        airplaneEntity = null
        canopyEntity = null
        pcEntity = null
        snivelEntity = null
        windVectorEntity = null
        airspeedVectorEntity = null
        inertialspeedVectorEntity = null
        magneticVectorEntity = null
        initialized = false
        Log.i(TAG, "WingsuitCanopySystem cleaned up")
    }
}
