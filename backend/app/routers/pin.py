# backend/app/routers/pin.py
# ✅ FIXED: Comprehensive error handling for rider-details endpoint
# ✅ FIXED: Proper database queries with explicit column filtering
# ✅ FIXED: Better error messages and logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_
import logging
from app.database import get_db
from app.models.rider import Rider
from app.models.bike_profile import BikeProfile
from app.models.pin_recovery_request import PinRecoveryRequest
from app.schemas.onboarding import PinCreateRequest, PinLoginRequest, PinRecoveryConfirmRequest
from app.services.pin_service import create_pin, verify_pin_login, reset_pin_via_recovery

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/onboarding", tags=["sb-04"])

@router.post("/pin/create")
def pin_create(payload: PinCreateRequest, rider_id: str = Query(...), db: Session = Depends(get_db)):
    return create_pin(db, rider_id, payload.pin, payload.pin_confirm)


@router.get("/rider-details/{rider_id}")
def get_rider_details(rider_id: str, db: Session = Depends(get_db)):
    """
    ✅ FIXED: New endpoint to fetch rider profile data after PIN creation.
    This endpoint returns all data needed by HomeScreen to initialize.
    
    ✅ FIXED: Comprehensive error handling and logging
    ✅ FIXED: Proper database queries with explicit filters
    ✅ FIXED: Safe attribute access with defaults
    
    Returns:
        {
            "ok": true,
            "rider": {
                "rider_id": uuid,
                "mobile_number": string,
                "full_name": string,
                "registration_status": "active" | "verified_incomplete",
                "onboarding_step": string
            },
            "bike_profile": {
                "id": uuid,
                "number_plate": string,
                "fuel_type_code": string
            },
            "account": {
                "rider_id": uuid,
                "mobile_number": string,
                "full_name": string,
                "registration_status": string
            }
        }
    """
    try:
        # Validate input
        if not rider_id or not rider_id.strip():
            raise HTTPException(
                status_code=400,
                detail="Rider ID is required"
            )
        
        # ✅ FIXED: Use explicit filter instead of filter_by
        try:
            rider = db.query(Rider).filter(
                Rider.id == rider_id
            ).first()
            
            if not rider:
                logger.warning(f"Rider not found: {rider_id}")
                raise HTTPException(
                    status_code=404, 
                    detail="Rider account not found. Please complete registration."
                )
        except HTTPException:
            raise
        except Exception as db_err:
            logger.error(f"Database error fetching rider {rider_id}: {str(db_err)}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail="Error retrieving rider information. Please try again."
            )
        
        # ✅ FIXED: Proper bike profile query with error handling
        bike_profile = None
        try:
            bike_profile = db.query(BikeProfile).filter(
                and_(
                    BikeProfile.rider_id == rider_id,
                    BikeProfile.is_active == True
                )
            ).order_by(BikeProfile.submitted_at.desc()).first()
        except Exception as bike_err:
            logger.warning(f"Error fetching bike profile for rider {rider_id}: {str(bike_err)}")
            # Continue without bike profile - it may not exist yet
        
        # ✅ FIXED: Safe attribute access with defaults
        onboarding_step = getattr(rider, 'onboarding_step', 'createPin') or 'createPin'
        full_name = getattr(rider, 'full_name', '') or ''
        registration_status = getattr(rider, 'registration_status', 'pending') or 'pending'
        
        logger.info(f"Retrieved rider details for {rider_id}: status={registration_status}, has_bike={bike_profile is not None}")
        
        return {
            "ok": True,
            "rider": {
                "rider_id": str(rider.id),
                "mobile_number": rider.mobile_number,
                "full_name": full_name,
                "registration_status": registration_status,
                "onboarding_step": onboarding_step
            },
            "bike_profile": {
                "id": str(bike_profile.id) if bike_profile else None,
                "number_plate": bike_profile.number_plate if bike_profile else None,
                "fuel_type_code": bike_profile.fuel_type_code if bike_profile else None,
                "is_active": bike_profile.is_active if bike_profile else None
            } if bike_profile else None,
            "account": {
                "rider_id": str(rider.id),
                "mobile_number": rider.mobile_number,
                "full_name": full_name,
                "registration_status": registration_status
            }
        }
    
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Unexpected error fetching rider details for {rider_id}: {str(err)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail="Unable to retrieve rider information. Please try again or contact support."
        )


@router.post("/pin/login")
def pin_login(payload: PinLoginRequest, db: Session = Depends(get_db)):
    return verify_pin_login(db, payload.rider_id, payload.pin)

# BR-SB04-007: recovery ALWAYS requires manual Super Admin verification against the registered number —
# same Rider Account Support queue used for mobile-number verification and duplicate-plate cases.
@router.post("/pin/recovery/start")
def pin_recovery_start(rider_id: str = Query(...), db: Session = Depends(get_db)):
    try:
        # ✅ FIXED: Explicit filter instead of .get()
        rider = db.query(Rider).filter(
            Rider.id == rider_id
        ).first()
        
        if not rider:
            raise HTTPException(
                status_code=404,
                detail="Rider not found"
            )
        
        request = PinRecoveryRequest(
            rider_id=rider.id, 
            mobile_number=rider.mobile_number, 
            status="pending"
        )
        db.add(request)
        db.commit()
        db.refresh(request)
        
        logger.info(f"PIN recovery started for rider {rider_id}")
        
        return {
            "recovery_request_id": str(request.id), 
            "status": request.status,
            "message": "Recovery request submitted. Admin will verify and approve within 24 hours."
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error starting PIN recovery for {rider_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to start recovery process. Please try again."
        )

@router.get("/pin/recovery/status")
def pin_recovery_status(recovery_request_id: str = Query(...), db: Session = Depends(get_db)):
    try:
        # ✅ FIXED: Explicit filter instead of .get()
        request = db.query(PinRecoveryRequest).filter(
            PinRecoveryRequest.id == recovery_request_id
        ).first()
        
        if not request:
            raise HTTPException(
                status_code=404,
                detail="Recovery request not found"
            )
        
        return {
            "recovery_request_id": str(request.id),
            "status": request.status,  # "pending" | "approved" | "rejected"
            "created_at": request.created_at.isoformat() if hasattr(request, 'created_at') else None,
            "can_proceed": request.status == "approved"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking recovery status for {recovery_request_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to check recovery status. Please try again."
        )

@router.post("/pin/recovery/confirm")
def pin_recovery_confirm(
    payload: PinRecoveryConfirmRequest, 
    rider_id: str = Query(...), 
    db: Session = Depends(get_db)
):
    try:
        # ✅ FIXED: Explicit filter instead of .get()
        request = db.query(PinRecoveryRequest).filter(
            PinRecoveryRequest.id == payload.recovery_request_id
        ).first()
        
        if not request:
            raise HTTPException(
                status_code=404,
                detail="Recovery request not found"
            )
        
        if request.status != "approved":
            logger.warning(f"Recovery attempt with non-approved request: {payload.recovery_request_id}")
            raise HTTPException(
                status_code=403, 
                detail="This recovery request has not been approved yet. Please wait for admin verification."
            )
        
        result = reset_pin_via_recovery(db, rider_id, payload.new_pin, payload.new_pin_confirm)
        
        logger.info(f"PIN recovered successfully for rider {rider_id}")
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error confirming PIN recovery for {rider_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Failed to reset PIN. Please try again or contact support."
        )